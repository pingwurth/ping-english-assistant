/**
 * 翻译基础设施 —— 纯 TS、无 React 依赖，供翻译页面与字幕双语生成共用。
 *
 * - translateTexts：分块（每 50 句一块）3 路有界并发调用 /api/translate，支持取消与进度回调
 * - detectDirection：基于 isCJK 占比的方向判定（口径与 detectBilingual 一致：>30%）
 * - mergeBilingualSrt：将译文合并回 SRT 生成双语字幕
 * - buildBilingualPreview：双语预览文本（英文行 + 中文行）
 */

import { parseSubtitle, exportSrt, isCJK, splitWords } from '@/core/subtitle'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection, TranslateResponse } from '@/types/api'

/** 每块提交给 /api/translate 的句数 */
const CHUNK_SIZE = 50
/** 并发块数（评审 #50：原逐块串行 await，1000 句 = 20 次串行 LLM 往返 100-200s；
 * 3 路有界并发按索引回填可缩一半以上。池深有意保持小，避免触发服务端限流） */
const CHUNK_CONCURRENCY = 3

/** 单块请求与响应校验（错误信息与取消语义同评审前口径） */
async function translateChunk(
  chunk: string[],
  configId: string | undefined,
  direction: TranslateDirection,
  signal?: AbortSignal,
): Promise<{ translations: string[]; filledWithSource: number }> {
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: chunk, direction, configId }),
    signal,
  })

  let data: (TranslateResponse & { error?: string }) | null = null
  try {
    data = (await res.json()) as (TranslateResponse & { error?: string }) | null
  } catch {
    // body 读取失败有两种可能：响应体确实非 JSON，或用户取消导致读取中断 ——
    // 先查中止，把主动取消与真实故障区分开（调用方对 AbortError 静默处理）
    if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')
  }

  if (!res.ok) {
    const message = data?.error || `翻译失败 (${res.status})`
    throw new Error(message)
  }
  if (!data) {
    // 2xx 但响应体非 JSON（如网关返回 HTML）：单独提示格式异常，避免误导为“条数不一致”
    throw new Error('翻译服务响应格式异常，请重试')
  }
  if (!data?.translations || data.translations.length !== chunk.length) {
    throw new Error('翻译结果与原文条数不一致，请重试')
  }
  return {
    translations: data.translations,
    filledWithSource: typeof data.filledWithSource === 'number' && data.filledWithSource > 0 ? data.filledWithSource : 0,
  }
}

/**
 * 分块翻译：每 50 句一块，CHUNK_CONCURRENCY 路有界并发、按块索引回填（结果顺序与原文一致）。
 * 进度回调只报累计完成数——两个消费方均只 setProgress，不依赖完成顺序。
 * @param texts      待翻译文本列表（空列表直接返回 []）
 * @param configId   模型配置 id（undefined 用默认配置）
 * @param direction  翻译方向（由调用方预先判定，不做 'auto'）
 * @param signal     取消信号（贯穿所有分块请求）
 * @param onProgress 每块完成后回调（累计完成数, 总条数）
 * @param onDegraded 服务端用原文回填了缺失译文时回调（回填条数, 总条数）——
 *                   回填是既定降级策略（结果仍完整返回），但调用方应向用户提示“部分未翻”
 * @throws 任意块失败时快速失败：抛首个错误并中止其余在途/未发块
 */
export async function translateTexts(
  texts: string[],
  configId: string | undefined,
  direction: TranslateDirection,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  onDegraded?: (filled: number, total: number) => void,
): Promise<string[]> {
  if (texts.length === 0) return []
  if (signal?.aborted) throw new Error('翻译已取消')

  const chunkCount = Math.ceil(texts.length / CHUNK_SIZE)
  const chunkResults: string[][] = new Array(chunkCount)
  // 内部中止源：任一块失败即中止其余在途请求（调用方 signal 经由监听联动）
  const controller = new AbortController()
  const onCallerAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onCallerAbort, { once: true })

  let nextChunk = 0
  let doneCount = 0
  let firstError: unknown = null
  let filledTotal = 0

  const worker = async (): Promise<void> => {
    while (firstError === null) {
      const idx = nextChunk++
      if (idx >= chunkCount) return
      const chunk = texts.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE)
      try {
        const outcome = await translateChunk(chunk, configId, direction, controller.signal)
        chunkResults[idx] = outcome.translations
        filledTotal += outcome.filledWithSource
        doneCount += chunk.length
        onProgress?.(Math.min(doneCount, texts.length), texts.length)
      } catch (err) {
        if (firstError === null) {
          firstError = err
          controller.abort()
        }
        return
      }
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunkCount) }, () => worker()),
    )
  } finally {
    signal?.removeEventListener('abort', onCallerAbort)
  }

  if (firstError !== null) throw firstError
  if (filledTotal > 0) onDegraded?.(filledTotal, texts.length)
  return chunkResults.flat()
}

/**
 * 方向判定：含 CJK 的文本占比 >30% → 'zh2en'（原文以中文为主），否则 'en2zh'。
 * 口径与 core/subtitle 的 detectBilingual 一致。
 */
export function detectDirection(texts: string[]): TranslateDirection {
  if (texts.length === 0) return 'en2zh'
  const cjkCount = texts.filter((t) => isCJK(t)).length
  return cjkCount / texts.length > 0.3 ? 'zh2en' : 'en2zh'
}

/**
 * 将译文合并回 SRT 字幕，输出双语（英上中下）SRT 文本。
 * - en2zh：保留原 textEn 与 words，textZh = 译文
 * - zh2en：textEn = 译文（用 splitWords 重算 words），textZh = 原英文文本
 * @throws 译文条数与字幕条数不一致时抛出错误
 */
export function mergeBilingualSrt(
  srt: string,
  translations: string[],
  direction: TranslateDirection,
): string {
  const { sentences } = parseSubtitle(srt)
  if (sentences.length !== translations.length) {
    throw new Error('译文条数与字幕条数不一致')
  }

  const merged: SubtitleSentence[] = sentences.map((s, i) => {
    if (direction === 'en2zh') {
      // 保留原 textEn 与原 words
      return { ...s, textZh: translations[i] }
    }
    // zh2en：译文作为英文行，原英文文本降为中文行，重算 words
    return { ...s, textEn: translations[i], textZh: s.textEn, words: splitWords(translations[i]) }
  })

  return exportSrt(merged)
}

/** 双语预览：逐句输出"英文行 + 中文行（若存在）"，句间空行分隔 */
export function buildBilingualPreview(sentences: SubtitleSentence[]): string {
  return sentences
    .map((s) => (s.textZh ? `${s.textEn}\n${s.textZh}` : s.textEn))
    .join('\n\n')
}
