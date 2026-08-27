/**
 * 翻译基础设施 —— 纯 TS、无 React 依赖，供翻译页面与字幕双语生成共用。
 *
 * - translateTexts：分块（每 50 句一块）串行调用 /api/translate，支持取消与进度回调
 * - detectDirection：基于 isCJK 占比的方向判定（口径与 detectBilingual 一致：>30%）
 * - mergeBilingualSrt：将译文合并回 SRT 生成双语字幕
 * - buildBilingualPreview：双语预览文本（英文行 + 中文行）
 */

import { parseSubtitle, exportSrt, isCJK, splitWords } from '@/core/subtitle'
import type { SubtitleSentence } from '@/types/subtitle'
import type { TranslateDirection, TranslateResponse } from '@/types/api'

/** 每块提交给 /api/translate 的句数 */
const CHUNK_SIZE = 50

/**
 * 分块翻译：每 50 句一块串行调用 /api/translate。
 * @param texts      待翻译文本列表（空列表直接返回 []）
 * @param configId   模型配置 id（undefined 用默认配置）
 * @param direction  翻译方向（由调用方预先判定，不做 'auto'）
 * @param signal     取消信号（贯穿所有分块请求）
 * @param onProgress 每块完成后回调（累计完成数, 总条数）
 * @throws 非 2xx 时抛出服务端返回的中文错误信息
 */
export async function translateTexts(
  texts: string[],
  configId: string | undefined,
  direction: TranslateDirection,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  if (texts.length === 0) return []

  const results: string[] = []
  for (let start = 0; start < texts.length; start += CHUNK_SIZE) {
    if (signal?.aborted) throw new Error('翻译已取消')

    const chunk = texts.slice(start, start + CHUNK_SIZE)
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: chunk, direction, configId }),
      signal,
    })

    const data = (await res.json().catch(() => null)) as
      | (TranslateResponse & { error?: string })
      | null

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

    results.push(...data.translations)
    onProgress?.(Math.min(results.length, texts.length), texts.length)
  }

  return results
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
