/**
 * Azure Pronunciation Assessment provider —— 首发主方案（选型报告 §5.1）。
 *
 * 调用 Azure Speech「REST 短音频」接口 + Pronunciation-Assessment 头（base64 JSON）：
 *   POST {host}/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed
 *   - Ocp-Apim-Subscription-Key 认证（密钥仅存服务端 env）
 *   - Content-Type: audio/wav; codecs=audio/pcm; samplerate=16000（契约②的 16k mono WAV 原样透传）
 *   - Dimension=Comprehensive 必须显式指定：默认 Basic 只返回准确度，拿不到流利度/完整度与词级 ErrorType
 *   - 音素口径 IPA；EnableMiscue 开启漏读/增读判定
 * 接口细节查询于 2026-10：learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short
 *
 * 限制：PA 音频 ≤30s（本项目跟读逐句场景 5s 量级，安全）。
 * 超时 SOE_TIMEOUT_MS + 重试 SOE_RETRY 次（仅网络错/408/429/5xx 重试，报告 §6.1）。
 */

import { ERR, apiError } from '../../lib/api-error'
import type { Env } from '../../config/env'
import { mapAzureToContract, type AzurePronResponse } from './soe-mapper'
import { withSoeRetry } from './soe-retry'
import type { SoeEvaluateResponse, SoeInput, SoeProvider } from './soe-provider'

/** 无语音/未识别的状态 → 4xx 语义（用户没说话，非上游故障） */
const NO_SPEECH_STATUS = new Set(['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout'])

export function createAzureSoeProvider(env: Env): SoeProvider {
  const base = (env.AZURE_SPEECH_HOST ?? `https://${env.AZURE_SPEECH_REGION}.stt.speech.microsoft.com`).replace(/\/+$/, '')
  const url = `${base}/stt/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`

  const evaluate = async (input: SoeInput, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    // REST 头要求 base64 编码的 JSON（PascalCase；布尔参数用 "True"/"False" 字符串）
    const params = {
      ReferenceText: input.refText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
      PhonemeAlphabet: 'IPA',
    }
    const pronHeader = Buffer.from(JSON.stringify(params), 'utf8').toString('base64')

    // 重试判定与退避见 soe-retry.ts（评审 #34：三 provider 重试循环收敛为 withSoeRetry）
    return withSoeRetry(env, () => callOnce(input, pronHeader, signal), signal)
  }

  const callOnce = async (input: SoeInput, pronHeader: string, signal?: AbortSignal): Promise<SoeEvaluateResponse> => {
    if (!env.AZURE_SPEECH_KEY) throw apiError(ERR.SOE_UPSTREAM_ERROR, 'AZURE_SPEECH_KEY 未配置')

    let res: Response
    const timeoutSignal = AbortSignal.timeout(env.SOE_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          Accept: 'application/json',
          'Pronunciation-Assessment': pronHeader,
        },
        body: input.audio,
        signal: combined,
      })
    } catch (err) {
      if (signal?.aborted) throw err // 调用方取消：原样上抛
      // AbortSignal.timeout 触发的是 TimeoutError，才是真超时（不重试）；
      // 其余（ECONNRESET/DNS 抖动等 'fetch failed'）是连接层瞬断，映射为
      // SOE_UPSTREAM_ERROR + reason 走 soe-retry 自动重试——与 tencent/iflytek
      // 口径一致（评审 #21：原一律 UPSTREAM_TIMEOUT 被短路判死且误导排障）
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw apiError(ERR.UPSTREAM_TIMEOUT, '评分上游请求超时', { reason: err.message })
      }
      const reason = err instanceof Error ? err.message : String(err)
      throw apiError(ERR.SOE_UPSTREAM_ERROR, '评分上游网络错误（连接失败/中断）', { reason })
    }

    if (res.status === 200) {
      const body = (await res.json()) as AzurePronResponse
      if (body.RecognitionStatus !== 'Success') {
        if (NO_SPEECH_STATUS.has(body.RecognitionStatus)) {
          throw apiError(ERR.SOE_NO_SPEECH, '未检测到语音，请对着麦克风再读一次', { status: body.RecognitionStatus })
        }
        throw apiError(ERR.SOE_UPSTREAM_ERROR, '评分服务内部错误，请稍后重试', { status: body.RecognitionStatus })
      }
      const nbest = body.NBest?.[0]
      if (!nbest) throw apiError(ERR.SOE_UPSTREAM_ERROR, '评分响应缺少结果（NBest 为空）')
      return mapAzureToContract(nbest)
    }

    const text = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw apiError(ERR.SOE_UPSTREAM_ERROR, 'Azure 认证失败：检查 AZURE_SPEECH_KEY / REGION(HOST) 配置', { status: res.status, body: text.slice(0, 500) })
    }
    if (res.status === 429) throw apiError(ERR.UPSTREAM_RATE_LIMIT, '评分上游限流，请稍后重试')
    if (res.status === 400) {
      // 通常为音频格式问题（非 RIFF/WAVE、非 16k mono PCM）
      throw apiError(ERR.SOE_UPSTREAM_ERROR, '评分上游拒绝了音频数据（格式不符）', { body: text.slice(0, 500) })
    }
    throw apiError(ERR.SOE_UPSTREAM_ERROR, `评分上游错误（HTTP ${res.status}）`, { status: res.status, body: text.slice(0, 500) })
  }

  return { name: 'azure', evaluate }
}
