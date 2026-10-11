/**
 * 腾讯云「口语评测（新版/OEN）」provider —— wss://soe.cloud.tencent.com/soe/api/<appid>。
 *
 * 录音模式（rec_mode=1）一次性 WS 会话（结构与官方 JS SDK soe/src/soeSocket.ts 同构）：
 *   - 全部初始化参数进 URL query（含 HMAC-SHA1+Base64 签名，构造见 tencent-ws-auth.ts）
 *   - 握手成功首帧 {"code":0,"message":"success","voice_id":"..."}；code!==0 即失败
 *   - 音频整段单二进制帧上行（裸字节、非 base64，≤60s），随后文本帧 {"type":"end"}
 *   - 结果均为文本帧 {"code","message","voice_id","message_id","result","final"}：
 *     result 是内嵌 JSON 字符串；final=1 后客户端主动 close(1000)
 *   - 常见错误码：4002 鉴权失败 / 4006 并发超限 / 4008 分片等待超时 / 4105 无人声（4000~5002 族）
 * 接口文档查询于 2026-10：cloud.tencent.com/document/product/1774/107497。
 * 超时 SOE_TIMEOUT_MS + 重试 SOE_RETRY 次（与 azure/iflytek 相同重试条件，报告 §6.1）。
 */

import WebSocket from 'ws'
import { ApiError, ERR, apiError } from '../../lib/api-error'
import type { Env } from '../../config/env'
import { mapTencentToContract, type TencentSoeResponse } from './soe-mapper'
import { buildTencentSoeWsUrl } from './tencent-ws-auth'
import type { SoeEvaluateResponse, SoeInput, SoeProvider } from './soe-provider'

/** OEN 录音模式整段音频上限：60s @16kHz/16bit/mono ≈ 1.92MB */
const MAX_AUDIO_BYTES = 1_920_000

/** 腾讯 OEN WS 文本帧中我们关心的子集 */
interface SoeWsMessage {
  code?: number
  message?: string
  voice_id?: string
  message_id?: number
  /** 内嵌 JSON 字符串（final=1 帧携带完整评分结果；防御：也可能已是对象） */
  result?: string | TencentSoeResponse
  final?: number
}

/** WS 错误码 → 契约错误（错误码族 4000~5002，常见值见类头注释） */
function mapWsError(code: number, message: string | undefined): ApiError {
  if (code === 4002) {
    return apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯云鉴权失败：检查 TENCENT_SECRET_ID / TENCENT_SECRET_KEY / TENCENT_APP_ID', {
      code,
      message,
    })
  }
  if (code === 4006) return apiError(ERR.UPSTREAM_RATE_LIMIT, '评分上游并发超限，请稍后重试', { code, message })
  if (code === 4008) return apiError(ERR.UPSTREAM_TIMEOUT, '评分上游分片等待超时', { code, message })
  if (code === 4105) return apiError(ERR.SOE_NO_SPEECH, '未检测到语音，请对着麦克风再读一次', { code })
  return apiError(ERR.SOE_UPSTREAM_ERROR, `腾讯 SOE 错误 ${code}: ${message ?? ''}`, { code, message })
}

export function createTencentSoeProvider(env: Env): SoeProvider {
  const evaluate = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    // 录音模式整段上限提前拒绝（确定性失败，重试无意义）
    if (input.audio.length > MAX_AUDIO_BYTES) {
      throw apiError(ERR.PAYLOAD_TOO_LARGE, '腾讯 SOE 录音模式整段音频上限约 60s（1.92MB），请缩短录音', {
        bytes: input.audio.length,
      })
    }

    const attempts = env.SOE_RETRY + 1
    let lastErr: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        // 每次重试独立会话：重新生成 timestamp/nonce/voice_id/签名/连接
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
    if (!env.TENCENT_APP_ID || !env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
      throw apiError(ERR.SOE_UPSTREAM_ERROR, 'TENCENT_APP_ID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY 未配置')
    }

    const { url } = buildTencentSoeWsUrl({
      appId: env.TENCENT_APP_ID,
      secretId: env.TENCENT_SECRET_ID,
      secretKey: env.TENCENT_SECRET_KEY,
      refText: input.refText,
    })

    const timeoutSignal = AbortSignal.timeout(env.SOE_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

    return await new Promise<SoeEvaluateResponse>((resolve, reject) => {
      let settled = false
      let sock: WebSocket

      const onAbort = (): void => {
        if (signal?.aborted) {
          // 调用方取消：原样上抛（非 ApiError → 不重试）
          fail(signal.reason ?? new Error('aborted'))
        } else {
          fail(apiError(ERR.UPSTREAM_TIMEOUT, '腾讯 SOE 会话超时'))
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

      sock = new WebSocket(url, { handshakeTimeout: env.SOE_TIMEOUT_MS })

      // 握手非 101（签名/参数错时腾讯直接拒绝协议升级）
      sock.on('unexpected-response', (_req, res) => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯 WS 握手失败', { statusCode: res.statusCode }))
      })
      sock.on('error', (err: Error) => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯 WS 连接错误', { reason: err.message }))
      })
      // 正常收尾在 settle 中先置 settled；此处只兜「结果未回先断」（与官方 SDK onclose 同判）
      sock.on('close', () => {
        fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯连接在结果返回前关闭'))
      })

      sock.on('open', () => {
        try {
          // 录音模式：整段 WAV 单二进制帧（Buffer 直发即 binary，无需 base64），再发结束标记
          sock.send(input.audio)
          sock.send(JSON.stringify({ type: 'end' }))
        } catch (err) {
          fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯音频发送失败', {
            reason: err instanceof Error ? err.message : String(err),
          }))
        }
      })

      sock.on('message', (raw: Buffer, isBinary: boolean) => {
        if (isBinary) return // 评分结果均为文本帧，二进制帧直接忽略
        let msg: SoeWsMessage
        try {
          msg = JSON.parse(raw.toString('utf8')) as SoeWsMessage
        } catch {
          fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯评分消息解析失败'))
          return
        }
        if (typeof msg.code === 'number' && msg.code !== 0) {
          fail(mapWsError(msg.code, msg.message))
          return
        }
        if (msg.final === 1) {
          if (msg.result === undefined) {
            fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯评分响应缺少结果字段', { message: msg.message }))
            return
          }
          // result 是内嵌 JSON 字符串（防御：已对象则直接用）
          let result: TencentSoeResponse
          if (typeof msg.result === 'string') {
            try {
              result = JSON.parse(msg.result) as TencentSoeResponse
            } catch {
              fail(apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯评分结果解析失败'))
              return
            }
          } else {
            result = msg.result
          }
          settle(mapTencentToContract(result))
        }
        // 其余为中间帧（握手成功/识别中），忽略
      })
    })
  }

  const isRetryable = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false
    return err.code === ERR.UPSTREAM_TIMEOUT.code || err.code === ERR.SOE_UPSTREAM_ERROR.code
  }

  return { name: 'tencent', evaluate }
}
