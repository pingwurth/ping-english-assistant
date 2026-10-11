/**
 * 腾讯云智聆口语评测（SOE）provider —— 备选方案（选型报告 §5.2）。
 *
 * TC3-HMAC-SHA256 签名 POST https://soe.tencentcloudapi.com（soe 2018-07-24 版）：
 *   - TransmitOralProcessWithInit 一次性模式：WorkMode=1（整段音频 base64 随 UserAudioData 提交）
 *   - EvalMode=1 句子级 / ServerType=0 英文 / VoiceFileType=2 wav（保留头）/ VoiceEncodeType=1 base64
 *   - ⚠️ 勿手动设置 Host 头 —— WHATWG fetch 禁止头会被静默丢弃，Host 由 URL 决定，签名仍用 HOST 常量
 *   - ⚠️ 多数腾讯 API 错误是 HTTP 200 + body.Response.Error：先查信封再看状态码
 * 接口细节查询于 2026-10：cloud.tencent.com/document/product/884
 * 超时 SOE_TIMEOUT_MS + 重试 SOE_RETRY 次（仅网络错/超时/上游错重试，报告 §6.1）。
 */

import { randomUUID } from 'node:crypto'
import { ApiError, ERR, apiError } from '../../lib/api-error'
import type { Env } from '../../config/env'
import { mapTencentToContract, type TencentSoeResponse } from './soe-mapper'
import { tc3HmacSha256Sign } from './tencent-sign'
import type { SoeEvaluateResponse, SoeInput, SoeProvider } from './soe-provider'

const HOST = 'soe.tencentcloudapi.com'
const SERVICE = 'soe'
const VERSION = '2018-07-24'
const ACTION = 'TransmitOralProcessWithInit'
/** 单片音频上限：raw 700KB → base64 ≈ 933KB < API 1MB 上限 */
const MAX_RAW_BYTES = 700_000

/** 信封内 Error.Code → 契约错误（腾讯 API 错误的主要形态：HTTP 200 + Response.Error） */
function mapEnvelopeError(err: NonNullable<TencentSoeResponse['Response']['Error']>): ApiError {
  const code = err.Code
  if (code.startsWith('AuthFailure') || code.startsWith('UnauthorizedOperation')) {
    return apiError(ERR.SOE_UPSTREAM_ERROR, '评分上游认证失败：检查 TENCENT_SECRET_ID / TENCENT_SECRET_KEY', {
      code,
      message: err.Message,
    })
  }
  if (code.startsWith('LimitExceeded') || code.startsWith('RequestLimitExceeded')) {
    return apiError(ERR.UPSTREAM_RATE_LIMIT, '评分上游限流，请稍后重试', { code })
  }
  if (code.includes('VadNotDetectedSpeak')) {
    return apiError(ERR.SOE_NO_SPEECH, '未检测到语音，请对着麦克风再读一次', { code })
  }
  if (code.includes('VoiceMsgOversized') || code.includes('TooLongPackage')) {
    return apiError(ERR.PAYLOAD_TOO_LARGE, '腾讯 SOE 单片音频上限约 1MB（base64），请缩短录音', { code })
  }
  const lower = code.toLowerCase()
  if (lower.includes('base64') || lower.includes('decode') || lower.includes('wav')) {
    return apiError(ERR.SOE_UPSTREAM_ERROR, '评分上游拒绝了音频数据（格式不符）', { code, message: err.Message })
  }
  return apiError(ERR.SOE_UPSTREAM_ERROR, '评分上游错误', { code, message: err.Message })
}

export function createTencentSoeProvider(env: Env): SoeProvider {
  const url = `https://${HOST}/`

  const evaluate = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    // 上游单片上限提前拒绝（不可重试的确定性失败）
    if (input.audio.length > MAX_RAW_BYTES) {
      throw apiError(ERR.PAYLOAD_TOO_LARGE, '腾讯 SOE 单片音频上限约 1MB（base64），请缩短录音', {
        bytes: input.audio.length,
      })
    }

    const attempts = env.SOE_RETRY + 1
    let lastErr: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await callOnce(input, signal)
      } catch (err) {
        lastErr = err
        // 超时/客户端断开不重试；网络错与 5xx/429 按配置重试
        if (attempt === attempts || !isRetryable(err)) throw err
      }
    }
    throw lastErr // 不可达（attempts≥1），取悦类型系统
  }

  const callOnce = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    if (!env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
      throw apiError(ERR.SOE_UPSTREAM_ERROR, 'TENCENT_SECRET_ID / TENCENT_SECRET_KEY 未配置')
    }

    // 签名与发送必须用同一个 JSON.stringify 产物（TC3 对 payload 做 sha256，差一个字节即签名失效）
    const timestamp = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({
      SessionId: randomUUID(),
      RefText: input.refText,
      SeqId: 1,
      IsEnd: 1,
      WorkMode: 1, // 一次性
      EvalMode: 1, // 句子
      ServerType: 0, // 英文
      ScoreCoefficient: 1.0,
      VoiceFileType: 2, // wav 头保留
      VoiceEncodeType: 1, // base64
      UserAudioData: input.audio.toString('base64'),
    })

    const sign = tc3HmacSha256Sign({
      secretId: env.TENCENT_SECRET_ID,
      secretKey: env.TENCENT_SECRET_KEY,
      service: SERVICE,
      host: HOST,
      action: ACTION,
      payload,
      timestamp,
    })

    let res: Response
    const timeoutSignal = AbortSignal.timeout(env.SOE_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: sign.authorization,
          'Content-Type': 'application/json; charset=utf-8',
          'X-TC-Action': ACTION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Version': VERSION,
        },
        body: payload,
        signal: combined,
      })
    } catch (err) {
      if (signal?.aborted) throw err // 调用方取消：原样上抛
      const reason = err instanceof Error ? err.message : String(err)
      throw apiError(ERR.UPSTREAM_TIMEOUT, '评分上游请求超时或网络不可达', { reason })
    }

    const text = await res.text().catch(() => '')
    let body: TencentSoeResponse | undefined
    try {
      body = JSON.parse(text) as TencentSoeResponse
    } catch {
      body = undefined
    }

    // (1) 信封内错误（腾讯多数 API 错误是 HTTP 200 + Response.Error）
    const envErr = body?.Response?.Error
    if (envErr) throw mapEnvelopeError(envErr)

    // (2) 非信封错误按状态码归一
    if (res.status !== 200) {
      if (res.status === 401 || res.status === 403) {
        throw apiError(ERR.SOE_UPSTREAM_ERROR, '腾讯认证失败：检查 TENCENT_SECRET_ID / TENCENT_SECRET_KEY', {
          status: res.status,
          body: text.slice(0, 500),
        })
      }
      if (res.status === 429) throw apiError(ERR.UPSTREAM_RATE_LIMIT, '评分上游限流，请稍后重试')
      throw apiError(ERR.SOE_UPSTREAM_ERROR, `评分上游错误（HTTP ${res.status}）`, { body: text.slice(0, 500) })
    }

    // (3) HTTP 200 无 Error 但缺结果字段
    const resp = body?.Response
    if (!resp || typeof resp.PronAccuracy !== 'number') {
      throw apiError(ERR.SOE_UPSTREAM_ERROR, '评分响应缺少结果字段', { body: text.slice(0, 500) })
    }
    return mapTencentToContract(resp)
  }

  const isRetryable = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false
    return err.code === ERR.UPSTREAM_TIMEOUT.code || err.code === ERR.SOE_UPSTREAM_ERROR.code
  }

  return { name: 'tencent', evaluate }
}
