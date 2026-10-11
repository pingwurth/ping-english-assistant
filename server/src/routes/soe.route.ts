/**
 * 契约② POST /api/v1/soe/evaluate —— 真源：docs/系统架构设计.md §3.3。
 *
 * 请求 multipart/form-data：
 *   - refText  参考原文（必填，≤1000 字符）
 *   - evalMode 固定 'sentence'（缺省即 sentence）
 *   - audio    wav/pcm 16kHz mono 单文件（≤25MB，与契约①共用上限；multipart 插件超限返 413）
 * 响应 200：契约② SoeEvaluateResponse；错误 { code, message, detail? }。
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { apiError, ERR } from '../lib/api-error'
import type { SoeProvider } from '../services/soe'

const MAX_REF_TEXT = 1000
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

/** 取 multipart 伴随文本字段的字符串值（字段可能是文件/值/数组，仅认字符串） */
function textField(fields: Record<string, unknown>, name: string): string | undefined {
  const item = Array.isArray(fields[name]) ? fields[name][0] : fields[name]
  if (item && typeof item === 'object' && 'value' in item && typeof item.value === 'string') return item.value
  return undefined
}

export function buildSoeRoute(provider: SoeProvider): FastifyPluginAsync {
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

      req.log.info({ soe: provider.name, bytes: audio.length, refText: refText.slice(0, 60) }, 'soe evaluate')
      const result = await provider.evaluate({ audio, refText, evalMode: 'sentence' })
      return await reply.status(200).send(result)
    })
  }
}
