/**
 * 契约② POST /api/v1/soe/evaluate —— 真源：docs/系统架构设计.md §3.3。
 *
 * 请求 multipart/form-data：
 *   - refText   参考原文（必填，≤1000 字符）
 *   - evalMode  固定 'sentence'（缺省即 sentence）
 *   - provider  可选 mock/azure/tencent/iflytek，覆盖默认实现
 *   - creds     可选 JSON 文本（请求级密钥，优先于 env；如 {"azure":{"key":"...","region":"..."}}）
 *               合并后凭据齐全即现场构造 provider，否则回落 env 注册表
 *   - audio     wav/pcm 16kHz mono 单文件（≤25MB，与契约①共用上限；multipart 插件超限返 413）
 * 响应 200：契约② SoeEvaluateResponse；错误 { code, message, detail? }。
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Env } from '../config/env'
import { apiError, ERR } from '../lib/api-error'
import { resolveSoeProvider, type SoeProviderName, type SoeProviderRegistry, type SoeRequestCreds } from '../services/soe'

const MAX_REF_TEXT = 1000
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const PROVIDER_NAMES: ReadonlySet<string> = new Set(['mock', 'azure', 'tencent', 'iflytek'])

/** 请求级密钥宽松校验：全字段可选字符串；未知键剥离（zod 默认行为） */
const credsSchema: z.ZodType<SoeRequestCreds> = z.object({
  azure: z
    .object({ key: z.string().optional(), region: z.string().optional(), host: z.string().optional() })
    .optional(),
  tencent: z
    .object({ appId: z.string().optional(), secretId: z.string().optional(), secretKey: z.string().optional() })
    .optional(),
  iflytek: z
    .object({
      appId: z.string().optional(),
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
    })
    .optional(),
})

/** 取 multipart 伴随文本字段的字符串值（字段可能是文件/值/数组，仅认字符串） */
function textField(fields: Record<string, unknown>, name: string): string | undefined {
  const item = Array.isArray(fields[name]) ? fields[name][0] : fields[name]
  if (item && typeof item === 'object' && 'value' in item && typeof item.value === 'string') return item.value
  return undefined
}

/** 解析可选 creds 字段：缺省 → undefined；非法 JSON/结构 → BAD_REQUEST */
function parseCreds(raw: string | undefined): SoeRequestCreds | undefined {
  if (raw === undefined || raw === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw apiError(ERR.BAD_REQUEST, 'creds 字段不是合法 JSON')
  }
  const result = credsSchema.safeParse(parsed)
  if (!result.success) {
    throw apiError(ERR.BAD_REQUEST, 'creds 字段结构不符（azure/tencent/iflytek 可选对象，值为字符串）')
  }
  return result.data
}

export function buildSoeRoute(registry: SoeProviderRegistry, env: Env): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    app.post('/api/v1/soe/evaluate', async (req, reply) => {
      // 单文件端点：req.file() 拿文件与伴随字段
      const file = await req.file()
      if (!file) throw apiError(ERR.BAD_REQUEST, '缺少 multipart 音频文件字段 audio')

      const refText = (textField(file.fields, 'refText') ?? '').trim()
      if (!refText) throw apiError(ERR.BAD_REQUEST, '缺少参考原文 refText')
      if (refText.length > MAX_REF_TEXT) throw apiError(ERR.BAD_REQUEST, `refText 超长（≤${MAX_REF_TEXT} 字符）`)

      const evalMode = textField(file.fields, 'evalMode') ?? 'sentence'
      if (evalMode !== 'sentence') throw apiError(ERR.BAD_REQUEST, 'SOE 仅支持 evalMode=sentence（契约②）')

      const audio = await file.toBuffer()
      if (audio.length === 0) throw apiError(ERR.BAD_REQUEST, '音频内容为空')
      if (audio.length > MAX_AUDIO_BYTES) throw apiError(ERR.PAYLOAD_TOO_LARGE, '音频超过 25MB 上限')

      // 可选 provider 覆盖：缺省用默认实现；未知名 400；密钥未配置（env 与请求级均不齐）503
      const providerField = textField(file.fields, 'provider')
      let name: SoeProviderName
      if (providerField === undefined || providerField === '') name = registry.defaultName
      else if (!PROVIDER_NAMES.has(providerField)) {
        throw apiError(ERR.BAD_REQUEST, `未知评分 provider：${providerField}（可选 mock/azure/tencent/iflytek）`)
      } else name = providerField as SoeProviderName
      const creds = parseCreds(textField(file.fields, 'creds'))
      const provider = resolveSoeProvider(registry, env, name, creds)
      if (!provider) {
        throw apiError(ERR.PROVIDER_UNAVAILABLE, `评分 provider「${name}」未在服务端配置（缺少对应密钥）`, {
          provider: name,
          available: [...registry.providers.keys()],
        })
      }

      // 客户端断开 → 中止上游（socket close 才代表连接中断；req.raw 'close' 在 body 读完后也会触发，不可用）
      const ac = new AbortController()
      req.raw.socket.once('close', () => {
        if (!reply.sent) ac.abort()
      })

      req.log.info({ soe: name, requestCreds: Boolean(creds), bytes: audio.length, refText: refText.slice(0, 60) }, 'soe evaluate')
      const result = await provider.evaluate({ audio, refText, evalMode: 'sentence' }, ac.signal)
      return await reply.status(200).send(result)
    })
  }
}
