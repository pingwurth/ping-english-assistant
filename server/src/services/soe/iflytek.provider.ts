/**
 * 科大讯飞 ISE 流式版 provider —— 备选方案。wss://ise-api.xfyun.cn/v2/open-ise
 *
 * 一次性 WS 会话（与官方 demo 同构）：
 *   - init 帧（cmd=ssb）：完整请求参数（common/business/text）整体 base64 进 data.text
 *   - 音频帧：aue=raw 裸 PCM（stripWavHeader 去头）按 1280B 分帧，status=1，
 *     帧间可按 IFLYTEK_FRAME_INTERVAL_MS 等待（官方建议 40ms；0 = 不等待）
 *   - 末帧 status=2；结果在 msg.data.result（base64 的 XML 分片）累积，status=2 时解析
 * 鉴权 URL 每次 attempt 重新生成（date 新鲜 —— 签名有效期约 5 分钟）。
 * 超时 SOE_TIMEOUT_MS + 重试 SOE_RETRY 次（与 azure 相同重试条件，报告 §6.1）。
 */

import WebSocket from 'ws'
import { ApiError, ERR, apiError } from '../../lib/api-error'
import type { Env } from '../../config/env'
import { mapIflytekToContract } from './soe-mapper'
import { parseIflytekResultXml } from './iflytek-xml'
import { buildIflytekWsUrl } from './iflytek-auth'
import { stripWavHeader } from './wav-pcm'
import type { SoeEvaluateResponse, SoeInput, SoeProvider } from './soe-provider'

const HOST = 'ise-api.xfyun.cn'
const PATH = '/v2/open-ise'
/** 每帧字节数（官方建议 1280B ≈ 40ms@16kHz/16bit） */
const FRAME_BYTES = 1280

/** 讯飞 WS 业务消息中我们关心的子集 */
interface IseMessage {
  code?: number
  message?: string
  data?: { status?: number; result?: string }
}

/** 鉴权族错误码（10160~10165 等：签名/密钥/授权问题）→ 命中时附加排查提示 */
function isAuthCode(code: number): boolean {
  return (code >= 10160 && code <= 10165) || code === 10105 || code === 10106
}

/** 可中止 sleep：signal 中止时立刻 reject（让发送循环解开） */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function createIflytekSoeProvider(env: Env): SoeProvider {
  const evaluate = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    const attempts = env.SOE_RETRY + 1
    let lastErr: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // 每次重试独立会话：重新生成 date/签名/连接
        return await sessionOnce(input, signal)
      } catch (err) {
        lastErr = err
        // 超时/客户端断开不重试；网络错与上游错误按配置重试
        if (attempt === attempts || !isRetryable(err)) throw err
      }
    }
    throw lastErr // 不可达（attempts≥1），取悦类型系统
  }

  const sessionOnce = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    if (!env.IFLYTEK_APP_ID || !env.IFLYTEK_API_KEY || !env.IFLYTEK_API_SECRET) {
      throw apiError(ERR.SOE_UPSTREAM_ERROR, 'IFLYTEK_APP_ID / IFLYTEK_API_KEY / IFLYTEK_API_SECRET 未配置')
    }

    const date = new Date().toUTCString()
    const { url } = buildIflytekWsUrl({
      apiKey: env.IFLYTEK_API_KEY,
      apiSecret: env.IFLYTEK_API_SECRET,
      host: HOST,
      path: PATH,
      date,
    })

    const timeoutSignal = AbortSignal.timeout(env.SOE_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    return await new Promise<SoeEvaluateResponse>((resolve, reject) => {
      let settled = false
      let xml = '' // base64 结果 XML 分片累积
      let sock: WebSocket

      const onAbort = (): void => {
        if (signal?.aborted) {
          // 调用方取消：原样上抛（非 ApiError → 不重试）
          fail(signal.reason ?? new Error('aborted'))
        } else {
          fail(apiError(ERR.UPSTREAM_TIMEOUT, '讯飞 ISE 会话超时'))
        }
      }

      const cleanup = (): void => combined.removeEventListener('abort', onAbort)

      const fail = (err: unknown): void => {
        if (settled) return
        settled = true
        cleanup()
        sock?.terminate()
        reject(err)
      }

      const settle = (value: SoeEvaluateResponse): void => {
        if (settled) return
        settled = true
        cleanup()
        sock?.close(1000)
        resolve(value)
      }

      combined.addEventListener('abort', onAbort, { once: true })
      if (combined.aborted) onAbort()

      sock = new WebSocket(url)

      // 握手非 101（401 最常见 = 签名/密钥问题）
      sock.on('unexpected-response', (_req, res) => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '讯飞 WS 握手失败', { statusCode: res.statusCode }))
      })
      sock.on('error', (err: Error) => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '讯飞 WS 连接错误', { reason: err.message }))
      })
      // 正常收尾在 settle 中先置 settled；此处只兜「结果未回先断」
      sock.on('close', () => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '讯飞连接在结果返回前关闭'))
      })

      sock.on('open', () => {
        void sendAll().catch((err) => {
          if (err instanceof ApiError) {
            fail(err)
          } else {
            fail(apiError(ERR.SOE_UPSTREAM_ERROR, '讯飞音频发送失败', {
              reason: err instanceof Error ? err.message : String(err),
            }))
          }
        })
      })

      sock.on('message', (raw: Buffer) => {
        let msg: IseMessage
        try {
          msg = JSON.parse(raw.toString('utf8')) as IseMessage
        } catch {
          fail(apiError(ERR.SOE_UPSTREAM_ERROR, '讯飞评分结果解析失败'))
          return
        }
        if (msg.code !== undefined && msg.code !== 0) {
          const hint = isAuthCode(msg.code) ? '，检查 IFLYTEK_APP_ID / IFLYTEK_API_KEY / IFLYTEK_API_SECRET' : ''
          fail(apiError(ERR.SOE_UPSTREAM_ERROR, `讯飞 ISE 错误 ${msg.code}: ${msg.message ?? ''}${hint}`, { code: msg.code }))
          return
        }
        // 结果 XML 以 base64 分片下发，逐片解码累积
        if (msg.data?.result) xml += Buffer.from(msg.data.result, 'base64').toString('utf8')
        if (msg.data?.status === 2) {
          const parsed = parseIflytekResultXml(xml)
          if (parsed.isRejected) {
            fail(apiError(ERR.SOE_NO_SPEECH, '未能识别出有效跟读内容，请重新朗读'))
            return
          }
          settle(mapIflytekToContract(parsed))
        }
      })

      const sendAll = async (): Promise<void> => {
        // 1) init 帧：官方 demo 同构 —— 首帧将完整请求 JSON base64 进 data.text
        const common = { app_id: env.IFLYTEK_APP_ID }
        const business = {
          sub: 'ise',
          cmd: 'ssb',
          ent: 'en_vip',
          category: 'read_sentence',
          tte: 'utf-8',
          ttp_skip: true,
          aue: 'raw',
          auf: 'audio/L16;rate=16000',
        }
        sock.send(
          JSON.stringify({
            common,
            business,
            data: {
              status: 0,
              text: Buffer.from(
                JSON.stringify({
                  common,
                  business,
                  text: { type: 'sentence', content: Buffer.from(input.refText, 'utf8').toString('base64') },
                }),
              ).toString('base64'),
            },
          }),
        )

        // 2) 音频帧：裸 PCM（aue=raw 需去 WAV 头）按 1280B 分片
        const pcm = stripWavHeader(input.audio)
        for (let off = 0; off < pcm.length; off += FRAME_BYTES) {
          if (off > 0 && env.IFLYTEK_FRAME_INTERVAL_MS > 0) {
            await abortableSleep(env.IFLYTEK_FRAME_INTERVAL_MS, combined)
          }
          if (combined.aborted) return // 已中止：停止发送，交由 onAbort 收尾
          sock.send(
            JSON.stringify({
              data: {
                status: 1,
                format: 'audio/L16;rate=16000',
                encoding: 'raw',
                audio: pcm.subarray(off, off + FRAME_BYTES).toString('base64'),
              },
            }),
          )
        }

        // 3) 末帧：无后续音频
        sock.send(JSON.stringify({ data: { status: 2, data: '' } }))
      }
    })
  }

  const isRetryable = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false
    return err.code === ERR.UPSTREAM_TIMEOUT.code || err.code === ERR.SOE_UPSTREAM_ERROR.code
  }

  return { name: 'iflytek', evaluate }
}
