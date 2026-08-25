/**
 * 双语启发式拆分 —— 真源：docs/系统架构设计.md §2.4 双语拆分规则（严格按文档实现）。
 *
 * 规则：
 *  1. 块内文本行（已去序号/时间轴行）参与判定；
 *  2. isCJK：含中日韩统一表意字符 → 中文行；
 *  3. 两行且上英下中 → textEn/textZh；上中下英 → 反序；单行 → textEn；
 *     多行（>2）→ 英文行合并为 textEn、中文行合并为 textZh；
 *  4. words：textEn 按空格切分并剥离首尾标点（保留撇号，如 don't 为一个词）。
 */

/** 含中日韩统一表意字符（含假名/谚文扩展区）即判为中文行 */
export function isCJK(line: string): boolean {
  return /[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/.test(line)
}

/** 剥离单词首尾标点（保留内部撇号：don't 仍为一个词） */
export function stripWordPunctuation(word: string): string {
  return word.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '')
}

/** textEn → words（供九宫格训练用） */
export function splitWords(textEn: string): string[] {
  return textEn
    .split(/\s+/)
    .map(stripWordPunctuation)
    .filter((w) => w.length > 0)
}

export interface SplitResult {
  textEn: string
  textZh: string | null
}

/** 块内文本行 → 英文/中文拆分（调用方保证已去除序号行与时间轴行） */
export function splitBilingual(lines: string[]): SplitResult {
  const ls = lines.map((l) => l.trim()).filter(Boolean)
  if (ls.length === 0) return { textEn: '', textZh: null }
  if (ls.length === 1) return { textEn: ls[0], textZh: null }
  if (ls.length === 2) {
    const [a, b] = ls
    const aCjk = isCJK(a)
    const bCjk = isCJK(b)
    if (!aCjk && bCjk) return { textEn: a, textZh: b }
    if (aCjk && !bCjk) return { textEn: b, textZh: a }
    // 两行同类（双英/双中）：按语义行并入对应语言
  }
  // 多行（或两行同类）：连续英文行合并为 textEn，连续中文行合并为 textZh
  const en = ls.filter((l) => !isCJK(l)).join(' ')
  const zh = ls.filter((l) => isCJK(l)).join('')
  return { textEn: en, textZh: zh || null }
}

/** 全文统计：含 textZh 的句子占比 >30% → 双语 */
export function detectBilingual(sentences: Array<{ textZh: string | null }>): boolean {
  if (sentences.length === 0) return false
  const zhCount = sentences.filter((s) => s.textZh != null && s.textZh.length > 0).length
  return zhCount / sentences.length > 0.3
}
