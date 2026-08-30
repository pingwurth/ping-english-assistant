/**
 * 助记 LLM 服务 —— 使用 LangChain ChatModel 生成助记卡片、联想、练习、批改
 *
 * 复用 factory.ts 的 createChatModel() 和 chat-service.ts 的 JSON 解析策略。
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from './factory'
import { LlmError, toLlmError } from './errors'
import type { ChatModelConfig } from './types'
import type { MnemonicCard, Association, Exercises, SentenceEvaluation, MnemonicSseEvent } from '@/types/mnemonic'

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

const CARD_SYSTEM_PROMPT = `You are a vocabulary mnemonic expert helping Chinese IELTS candidates build deep word knowledge.

## Output Requirements (strict JSON, no markdown fences, no extra text)

Return a JSON object with these fields:

### 1. core_meaning (核心含义)
- primary: The most essential English meaning (中文翻译 in parentheses)
- extended: 1-2 common extended/figurative meanings with brief explanation
- semantic_range: A 1-sentence description of what this word "feels like" — register, connotation, typical usage context (English only)

### 2. phonetic_mnemonic (发音助记)
- syllables: Break the word into syllables with IPA
- sound_shape: Describe the "sound shape" — stress, notable sounds (English, Chinese tips where helpful)
- homophones_rhymes: Array of words it sounds like or rhymes with

### 3. word_roots (词根词缀)
- breakdown: Morphological breakdown (prefix + root + suffix)
- root_family: Array of {word, meaning} for 3-5 words sharing the same root
- hook: A one-line memory trick in Chinese — make it vivid or funny

### 4. examples (例句)
- 2 example sentences showing DIFFERENT uses
- Each: {sentence (target word wrapped in **bold**), translation (中文), usage_note (brief)}

### 5. collocations (词组搭配)
- 2-3 high-frequency collocations
- Each: {phrase, meaning (中文), example (short sentence)}

### 6. difficulty
- "easy" | "medium" | "hard" — based on how commonly the word causes confusion for Chinese learners

## Rules
- English is primary; Chinese in parentheses for meanings, translations, memory hooks.
- semantic_range is English-only.
- word_roots.hook is Chinese-priority — memorable, even funny.
- If no clear etymology, set breakdown to "无明确词源" and root_family to [].
- Keep concise — this is a quick-reference card, not a textbook.
- Return ONLY valid JSON. No markdown fences, no comments, no extra text.`

const ASSOCIATION_SYSTEM_PROMPT = `You are a creative vocabulary memory coach for Chinese learners.

## Output (strict JSON, no markdown fences, no extra text)

{
  "type": "image" | "story" | "sound_play" | "absurd",
  "content": "The vivid association — in Chinese, make it stick in memory. Use sensory details, absurdity, or humor.",
  "why_it_works": "One sentence explaining the memory technique used"
}

## Rules
- Pick the type that works best for THIS word.
- "image": Visual scene connecting sound/shape to meaning.
- "story": Mini-narrative (2-3 sentences) linking sound to meaning.
- "sound_play": Pun or sound association in Chinese or English.
- "absurd": Exaggerated, silly scenario that's hard to forget.
- Help remember the ENGLISH word, not just the Chinese translation.
- Creative but not cringe. If nothing good, say so honestly.
- Return ONLY valid JSON.`

const EXERCISES_SYSTEM_PROMPT = `You are an IELTS vocabulary trainer. Generate practice exercises for active recall.

## Output (strict JSON, no markdown fences, no extra text)

{
  "ielts_blank": {
    "sentence": "The ___ of the experiment was...",
    "options": ["A. word", "B. distractor1", "C. distractor2", "D. distractor3"],
    "answer": "A",
    "explanation": "Why this answer is correct (中文)"
  },
  "listening_spot": [
    {
      "sentence": "Natural sentence containing the word",
      "difficulty": "easy" | "hard",
      "phonetic_hint": "What to listen for — stress, linking, reduction"
    }
  ],
  "writing_prompt": "A context/scenario that requires using the target word (中文)"
}

## Rules
- All content at IELTS Academic level.
- Distractors for gap-fill must be real words that make partial sense.
- listening_spot: 2 sentences, one easy, one hard.
- Return ONLY valid JSON.`

const EVALUATION_SYSTEM_PROMPT = `You are a supportive IELTS writing examiner.

## Output (strict JSON, no markdown fences, no extra text)

{
  "is_correct": true/false,
  "grammar_score": 1-5,
  "usage_score": 1-5,
  "feedback": "造句反馈，指出问题并鼓励（中文为主）",
  "improved_version": "A better version if needed",
  "example_sentence": "One more example showing a different usage"
}

## Rules
- Scores are 1-5.
- feedback is Chinese, encouraging but honest.
- If usage is wrong, explain the correct semantic range clearly.
- Return ONLY valid JSON.`

// ---------------------------------------------------------------------------
// JSON 解析（复用 chat-service.ts 的容错策略）
// ---------------------------------------------------------------------------

/**
 * 从 LLM 响应中提取 JSON 对象
 *
 * 容错策略：
 * 1. 剥离 ```json fences
 * 2. 截取首个 { 至末个 }
 * 3. JSON.parse
 * 4. 兜底：sanitizeJsonString
 */
function extractJsonObject<T>(content: string): T {
  let text = content.trim()

  // 剥离 markdown 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) text = fence[1].trim()

  // 截取首个 { 至末个 }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new LlmError('RESPONSE_FORMAT_ERROR', 'LLM 返回内容中未找到 JSON 对象')
  }

  const raw = text.slice(start, end + 1)

  try {
    return JSON.parse(raw) as T
  } catch {
    // 兜底：替换常见问题后重试
    const sanitized = raw
      .replace(/[“”]/g, '"')  // 中文双引号
      .replace(/[‘’]/g, "'")  // 中文单引号
      .replace(/\n/g, '\\n')            // 未转义换行
    try {
      return JSON.parse(sanitized) as T
    } catch {
      throw new LlmError('RESPONSE_FORMAT_ERROR', 'LLM 返回的 JSON 格式无法解析')
    }
  }
}

// ---------------------------------------------------------------------------
// 通用调用
// ---------------------------------------------------------------------------

/** callLlm 返回结果 + 耗时信息 */
interface LlmResult<T> {
  data: T
  timing: {
    invokeMs: number
    parseMs: number
    contentLength: number
  }
}

async function callLlm<T>(
  systemPrompt: string,
  userMessage: string,
  config: ChatModelConfig,
  signal?: AbortSignal,
): Promise<LlmResult<T>> {
  const model = createChatModel(config)
  try {
    const t0 = Date.now()
    const result = await model.invoke(
      [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
      { signal },
    )
    const invokeMs = Date.now() - t0

    const content = typeof result.content === 'string' ? result.content : ''
    if (!content.trim()) {
      throw new LlmError('RESPONSE_EMPTY', '助记接口未返回内容')
    }

    const t1 = Date.now()
    const parsed = extractJsonObject<T>(content)
    const parseMs = Date.now() - t1

    console.log('[MnemonicService] callLlm timing:', {
      invokeMs,
      parseMs,
      contentLength: content.length,
      model: config.model,
    })

    return { data: parsed, timing: { invokeMs, parseMs, contentLength: content.length } }
  } catch (err) {
    if (err instanceof LlmError) throw err
    throw toLlmError(err)
  }
}

// ---------------------------------------------------------------------------
// 流式调用
// ---------------------------------------------------------------------------

/** MnemonicCard 的顶层字段顺序（与 JSON 输出顺序一致） */
const CARD_FIELDS: (keyof MnemonicCard)[] = [
  'core_meaning',
  'phonetic_mnemonic',
  'word_roots',
  'examples',
  'collocations',
  'difficulty',
]

/**
 * 从部分 JSON 文本中提取已完整闭合的顶层字段
 *
 * 策略：先找到外层 { ，然后逐字段扫描，
 * 跟踪 depth 计数，当 depth 回到 1（顶层对象内部）时字段闭合。
 */
function extractCompletedFields(
  text: string,
  yielded: Set<string>,
): Array<{ field: string; value: unknown }> {
  const results: Array<{ field: string; value: unknown }> = []

  // 找到外层 {
  const objStart = text.indexOf('{')
  if (objStart === -1) return results

  let i = objStart + 1
  let depth = 1
  let inString = false
  let escaped = false

  while (i < text.length && depth > 0) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      i++
      continue
    }
    if (ch === '\\') {
      escaped = true
      i++
      continue
    }
    if (ch === '"') {
      if (!inString) {
        // 开始一个字符串 —— 可能是字段名
        const strStart = i + 1
        let j = strStart
        while (j < text.length) {
          if (text[j] === '\\') { j += 2; continue }
          if (text[j] === '"') break
          j++
        }
        if (j < text.length) {
          const strContent = text.slice(strStart, j)

          // 检查后面是否有冒号（字段名模式）
          let k = j + 1
          while (k < text.length && text[k] === ' ') k++

          if (k < text.length && text[k] === ':' && depth === 1) {
            // 这是一个顶层字段名
            const fieldName = strContent
            i = k + 1
            while (i < text.length && text[i] === ' ') i++

            if (!yielded.has(fieldName) && i < text.length) {
              // 找到值的结束位置
              const valStart = i
              let valDepth = 0
              let valInStr = false
              let valEsc = false
              let m = valStart

              for (; m < text.length; m++) {
                const vc = text[m]
                if (valEsc) { valEsc = false; continue }
                if (vc === '\\') { valEsc = true; continue }
                if (vc === '"') { valInStr = !valInStr; continue }
                if (valInStr) continue

                if (vc === '{' || vc === '[') valDepth++
                else if (vc === '}' || vc === ']') {
                  if (valDepth === 0) {
                    // 值闭合
                    const raw = text.slice(valStart, m + 1)
                    try {
                      const value = JSON.parse(raw)
                      results.push({ field: fieldName, value })
                    } catch { /* skip */ }
                    i = m + 1
                    break
                  }
                  valDepth--
                } else if (vc === ',' && valDepth === 0) {
                  // 简单值
                  const raw = text.slice(valStart, m).trim()
                  if (raw) {
                    try {
                      const value = JSON.parse(raw)
                      results.push({ field: fieldName, value })
                    } catch { /* skip */ }
                  }
                  i = m
                  break
                }
              }
              if (m >= text.length) return results
              continue
            }
          }

          // 不是顶层字段，跳过这个字符串
          i = j + 1
          inString = false
          continue
        }
      }
      inString = !inString
      i++
      continue
    }

    if (!inString) {
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') depth--
    }

    i++
  }

  return results
}

/** callLlmStream 返回的流式事件生成器 */
async function* callLlmStream<T>(
  systemPrompt: string,
  userMessage: string,
  config: ChatModelConfig,
  signal?: AbortSignal,
): AsyncGenerator<MnemonicSseEvent> {
  const model = createChatModel(config, { streaming: true })
  const t0 = Date.now()

  try {
    const stream = await model.stream(
      [new SystemMessage(systemPrompt), new HumanMessage(userMessage)],
      { signal },
    )

    let accumulated = ''
    const yielded = new Set<string>()

    for await (const chunk of stream) {
      const content = typeof chunk.content === 'string' ? chunk.content : ''
      if (!content) continue
      accumulated += content

      // 尝试提取已完整闭合的顶层字段
      const fields = extractCompletedFields(accumulated, yielded)
      for (const { field, value } of fields) {
        yielded.add(field)
        yield { event: 'field', data: { field: field as keyof MnemonicCard, value } }
      }
    }

    const invokeMs = Date.now() - t0

    // 流结束，解析完整 JSON
    if (!accumulated.trim()) {
      yield { event: 'error', data: { error: '助记接口未返回内容' } }
      return
    }

    const t1 = Date.now()
    const parsed = extractJsonObject<T>(accumulated)
    const parseMs = Date.now() - t1

    console.log('[MnemonicService] callLlmStream timing:', {
      invokeMs,
      parseMs,
      contentLength: accumulated.length,
      fieldsYielded: yielded.size,
      model: config.model,
    })

    yield {
      event: 'done',
      data: {
        card: parsed as unknown as MnemonicCard,
        timing: { invokeMs, parseMs, contentLength: accumulated.length },
      },
    }
  } catch (err) {
    const message = err instanceof LlmError ? err.message
      : err instanceof Error ? err.message : '流式生成失败'
    yield { event: 'error', data: { error: message } }
  }
}

// ---------------------------------------------------------------------------
// 导出方法
// ---------------------------------------------------------------------------

export async function generateMnemonicCard(
  word: string,
  context: string,
  note: string | undefined,
  config: ChatModelConfig,
  signal?: AbortSignal,
): Promise<LlmResult<MnemonicCard>> {
  const userMsg = `Word: ${word}\nContext sentence: ${context}${note ? `\nLearner's note: ${note}` : ''}`
  return callLlm<MnemonicCard>(CARD_SYSTEM_PROMPT, userMsg, config, signal)
}

/** 流式生成助记卡片 — 返回 AsyncGenerator，逐字段 yield */
export async function* generateMnemonicCardStream(
  word: string,
  context: string,
  note: string | undefined,
  config: ChatModelConfig,
  signal?: AbortSignal,
): AsyncGenerator<MnemonicSseEvent> {
  const userMsg = `Word: ${word}\nContext sentence: ${context}${note ? `\nLearner's note: ${note}` : ''}`
  yield* callLlmStream<MnemonicCard>(CARD_SYSTEM_PROMPT, userMsg, config, signal)
}

export async function generateAssociation(
  word: string,
  meaning: string,
  config: ChatModelConfig,
  signal?: AbortSignal,
): Promise<LlmResult<Association>> {
  const userMsg = `Word: ${word}\nCore meaning: ${meaning}`
  return callLlm<Association>(ASSOCIATION_SYSTEM_PROMPT, userMsg, config, signal)
}

export async function generateMnemonicExercises(
  word: string,
  meaning: string,
  collocations: string[],
  difficulty: string,
  config: ChatModelConfig,
  signal?: AbortSignal,
): Promise<LlmResult<Exercises>> {
  const userMsg = `Word: ${word}\nCore meaning: ${meaning}\nCollocations: ${collocations.join(', ')}\nDifficulty: ${difficulty}`
  return callLlm<Exercises>(EXERCISES_SYSTEM_PROMPT, userMsg, config, signal)
}

export async function evaluateSentence(
  word: string,
  meaning: string,
  sentence: string,
  config: ChatModelConfig,
  signal?: AbortSignal,
): Promise<LlmResult<SentenceEvaluation>> {
  const userMsg = `Word: ${word}\nExpected usage: ${meaning}\nLearner's sentence: ${sentence}`
  return callLlm<SentenceEvaluation>(EVALUATION_SYSTEM_PROMPT, userMsg, config, signal)
}
