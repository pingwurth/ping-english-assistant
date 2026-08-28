/**
 * Chat 服务 —— 基于 LangChain 的 chat completions 统一封装
 *
 * 当前用于翻译，未来可扩展到报告生成等场景。
 */

import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from './factory'
import { LlmError, toLlmError } from './errors'
import type { ChatModelConfig, TranslateConfig } from './types'
import type { TranslateDirection } from '@/types/api'

// ---------------------------------------------------------------------------
// 翻译
// ---------------------------------------------------------------------------

/** 单次请求文本条数上限 */
const MAX_TEXTS = 500

/** CJK 判定正则 */
const CJK_RE = /[⺀-鿿]/

/** 服务端方向自动判定 */
export function detectDirection(texts: string[]): TranslateDirection {
  const sample = texts.slice(0, 20)
  return sample.some((t) => CJK_RE.test(t)) ? 'zh2en' : 'en2zh'
}

/**
 * 使用 LangChain ChatModel 批量翻译文本
 *
 * @param texts    待翻译文本数组
 * @param config   翻译配置（含 provider、model、apiKey、baseUrl、direction）
 * @param signal   可选中止信号
 * @returns        翻译后的文本数组（与输入等长）
 * @throws         LlmError 翻译失败时抛出
 */
export async function translateTexts(
  texts: string[],
  config: TranslateConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  if (texts.length === 0) return []
  if (texts.length > MAX_TEXTS) {
    throw new LlmError('UPSTREAM_ERROR', `单次翻译最多 ${MAX_TEXTS} 条文本`)
  }

  const direction: TranslateDirection =
    config.direction === 'auto' || config.direction === undefined
      ? detectDirection(texts)
      : config.direction

  const targetLang = direction === 'zh2en' ? '英文' : '简体中文'
  const systemPrompt =
    `你是专业翻译。用户消息是一个 JSON 字符串数组，请将其逐条翻译为${targetLang}。` +
    '只返回与输入等长的 JSON 字符串数组，禁止增删条目、禁止 markdown 包裹、禁止任何额外文字。'

  const model = createChatModel(config)

  // 重试逻辑：校验失败自动重试 1 次，共 2 次
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.invoke(
        [
          new SystemMessage(systemPrompt),
          new HumanMessage(JSON.stringify(texts)),
        ],
        { signal },
      )

      const content = typeof result.content === 'string' ? result.content : ''
      if (!content.trim()) {
        throw new LlmError('RESPONSE_EMPTY', '翻译接口未返回内容')
      }

      const translations = extractTranslations(content, texts.length)
      if (translations) return translations

      // 条数不一致，重试
      lastError = new LlmError('RESPONSE_FORMAT_ERROR', '翻译结果与原文条数不一致')
    } catch (err) {
      if (err instanceof LlmError && err.code === 'RESPONSE_FORMAT_ERROR') {
        lastError = err
        continue // 重试
      }
      throw toLlmError(err)
    }
  }

  throw lastError || new LlmError('RESPONSE_FORMAT_ERROR', '翻译结果与原文条数不一致')
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * 从 LLM content 中提取 JSON 字符串数组
 * 容错：剥掉可能的 ```json 包裹；截取首个 `[` 至末个 `]` 再解析
 * 校验：长度与输入一致且每项为非空字符串；不通过返回 null
 */
function extractTranslations(content: string, expectedLength: number): string[] | null {
  let text = content.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) text = fence[1].trim()

  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null

  let arr: unknown
  try {
    arr = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(arr) || arr.length !== expectedLength) return null
  if (!arr.every((v) => typeof v === 'string' && v.trim().length > 0)) return null

  return arr.map((v) => (v as string).trim())
}
