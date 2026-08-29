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
/** 单次 LLM 调用的文本块大小（本地小模型输出 token 有限，需较小值） */
const LLM_CHUNK_SIZE = 15

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
 * 自动分块：将 texts 按 LLM_CHUNK_SIZE 分块串行调用模型，
 * 避免本地小模型因输出 token 不足导致 JSON 截断。
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

  const model = createChatModel(config)

  // 分块串行调用，避免本地小模型输出 token 不足导致 JSON 截断
  const results: string[] = []
  for (let start = 0; start < texts.length; start += LLM_CHUNK_SIZE) {
    signal?.throwIfAborted()
    const chunk = texts.slice(start, start + LLM_CHUNK_SIZE)
    const chunkResult = await translateSingleChunk(chunk, targetLang, model, signal)
    results.push(...chunkResult)
  }
  return results
}

/**
 * 单块翻译（含重试逻辑）
 */
async function translateSingleChunk(
  texts: string[],
  targetLang: string,
  model: ChatOpenAI,
  signal?: AbortSignal,
): Promise<string[]> {
  const basePrompt =
    `你是专业翻译。用户消息是一个 JSON 字符串数组，包含 ${texts.length} 条文本。` +
    `请严格保持条目数量不变，将第 i 条翻译后放入结果数组的第 i 位。` +
    `禁止合并多条为一条，禁止拆分一条为多条，禁止增删条目。` +
    `只返回与输入等长（${texts.length} 条）的 JSON 字符串数组，禁止 markdown 包裹、禁止任何额外文字。`

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 重试时追加纠错提示，避免模型重复同样的错误
      const systemPrompt = attempt === 0
        ? basePrompt
        : basePrompt + `\n\n重要提醒：上次你返回了错误的条数。输入共 ${texts.length} 条，你必须返回恰好 ${texts.length} 条翻译结果，不得合并任何条目。`

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

      // 条数不一致，记录诊断信息后重试
      const actualCount = countParsedItems(content)
      console.warn(
        `[Translate] 响应格式校验失败 (attempt ${attempt + 1}):`,
        `期望 ${texts.length} 条，实际 ${actualCount} 条`,
        `内容前 500 字符: ${content.slice(0, 500)}`,
      )
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
 *
 * 容错策略（按优先级）：
 * 1. 剥掉 ```json 包裹，截取首个 `[` 至末个 `]`
 * 2. 尝试 JSON.parse（标准 JSON，不触碰 CJK 引号）
 * 3. 若失败，检测是否 CJK 引号做分隔符，用逐字符解析器
 * 4. 兜底：sanitizeJsonString + tryFixMalformedJson
 *
 * 校验：长度与输入一致且每项为非空字符串；不通过返回 null
 */
function extractTranslations(content: string, expectedLength: number): string[] | null {
  let text = content.trim()
  // 1. 剥离 markdown 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) text = fence[1].trim()

  // 2. 截取首个 `[` 至末个 `]`
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return null

  const raw = text.slice(start, end + 1)

  // 3. 尝试标准 JSON.parse（不触碰 CJK 引号，避免破坏内容中的「」）
  try {
    const arr = JSON.parse(raw)
    if (Array.isArray(arr) && arr.length === expectedLength
      && arr.every((v) => typeof v === 'string' && v.trim().length > 0)) {
      return arr.map((v: string) => v.trim())
    }
  } catch {
    // 标准 JSON 解析失败，继续
  }

  // 4. CJK 引号做分隔符：模型用「」代替 " 做 JSON 分隔符。
  //    仅当第一个引号是「 时才使用（避免误伤内容中含「」的标准 JSON）。
  const cjkItems = parseCjkArray(raw, expectedLength)
  if (cjkItems) return cjkItems

  // 5. 兜底：sanitizeJsonString + tryFixMalformedJson
  const sanitized = sanitizeJsonString(raw)
  let arr: unknown
  try {
    arr = JSON.parse(sanitized)
  } catch {
    arr = tryFixMalformedJson(sanitized)
  }

  if (!Array.isArray(arr) || arr.length !== expectedLength) return null
  if (!arr.every((v) => typeof v === 'string' && v.trim().length > 0)) return null

  return arr.map((v) => (v as string).trim())
}

/**
 * CJK 引号感知的逐字符解析器
 *
 * 当模型用「」代替标准双引号做 JSON 数组分隔符时，
 * 标准 JSON.parse 无法解析。此函数逐字符扫描，
 * 同时支持 "..."、「...」作为字符串边界。
 *
 * 仅当第一个引号是「 时调用（避免误伤内容含「」的标准 JSON）。
 */
function parseCjkArray(raw: string, expectedLength: number): string[] | null {
  // 找到第一个引号字符，判断是否 CJK 分隔符
  const afterBracket = raw.indexOf('[')
  if (afterBracket === -1) return null

  let firstQuotePos = -1
  for (let i = afterBracket + 1; i < raw.length; i++) {
    const ch = raw[i]
    if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t' && ch !== ',') {
      firstQuotePos = i
      break
    }
  }
  if (firstQuotePos === -1) return null

  const firstChar = raw[firstQuotePos]
  // 只有当第一个引号是「或"时才用 CJK 解析器
  if (firstChar !== '「' && firstChar !== '“' && firstChar !== '"') return null

  // 逐字符解析
  const items: string[] = []
  let inStr = false
  let escape = false
  let start = -1
  let quoteChar = ''

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (!inStr) {
      if (ch === '"' || ch === '「' || ch === '“') {
        inStr = true
        start = i + 1
        quoteChar = ch
      }
    } else {
      const isClose =
        (ch === '"' && quoteChar === '"') ||
        (ch === '」' && quoteChar === '「') ||
        (ch === '”' && quoteChar === '“')
      if (isClose) {
        items.push(raw.slice(start, i))
        inStr = false
      }
    }
  }

  if (items.length !== expectedLength) return null
  if (!items.every((s) => s.trim().length > 0)) return null
  return items.map((s) => s.trim())
}

// CJK 引号和智能引号的正则（使用 Unicode 转义避免编码问题）
const CJK_QUOTE_RE = /[「」””’’]/g
const CJK_QUOTE_TEST_RE = /[「」””’’]/


/**
 * 清洗模型返回中常见的 JSON 格式问题
 *
 * 本地小模型（7B 等）常犯的错误：
 * - 使用「」"" '' 替代标准双引号
 * - 使用 CJK 右引号 」 替代 "," 分隔符
 * - 字符串内含有未转义的换行符
 */
function sanitizeJsonString(raw: string): string {
  let s = raw

  // 仅在检测到 CJK/智能引号时执行替换，避免破坏已合法的 JSON
  const hadCjkQuotes = CJK_QUOTE_TEST_RE.test(s)

  // 将 CJK 引号和智能引号统一替换为标准双引号
  s = s.replace(CJK_QUOTE_RE, '"')

  // 仅当原始内容包含 CJK/智能引号时，才修复连续引号问题
  // 避免误伤包含转义引号的合法 JSON（如 \" 变成 "" 后被替换为 ","）
  if (hadCjkQuotes) {
    s = s.replace(/"{2,}/g, '","')
    // 修复开头多余的逗号或引号
    s = s.replace(/^\[\s*,/, '[')
    s = s.replace(/,\s*$/, ']')
  }

  return s
}

/**
 * 尝试修复格式严重损坏的 JSON
 *
 * 当标准清洗仍无法解析时，逐行提取看起来像翻译结果的字符串。
 * 这是最后的兜底手段，只有在模型输出完全无法解析时才使用。
 */
function tryFixMalformedJson(raw: string): unknown {
  // 尝试用正则提取所有被引号包裹的字符串
  const matches = raw.match(/"([^"\\]|\\.)*"/g)
  if (!matches) return null

  try {
    // 将提取的字符串重新组装为合法 JSON 数组
    return JSON.parse('[' + matches.join(',') + ']')
  } catch {
    return null
  }
}

/**
 * 尝试解析 content 并返回实际条目数，用于诊断日志
 *
 * 与 extractTranslations 不同，此函数不做长度校验，
 * 仅返回解析后的数组长度（或 '?' 表示解析失败）。
 */
function countParsedItems(content: string): number | string {
  try {
    let text = content.trim()
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence?.[1]) text = fence[1].trim()

    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end <= start) return '?'

    const raw = text.slice(start, end + 1)

    // 尝试标准 JSON.parse
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.length
    } catch { /* 继续 */ }

    // 尝试 CJK 感知解析
    const cjkItems = parseCjkArray(raw, Infinity)
    if (cjkItems) return cjkItems.length

    // 兜底：sanitizeJsonString 后解析
    const sanitized = sanitizeJsonString(raw)
    const arr = JSON.parse(sanitized)
    return Array.isArray(arr) ? arr.length : '?'
  } catch {
    return '?'
  }
}
