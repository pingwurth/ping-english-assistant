/**
 * 双语拆分（架构文档 §2.4 bilingual.ts，启发式规则）
 * 1. 块内按行分组，文本行参与判定
 * 2. isCJK：含中日韩统一表意字符 → 中文行
 * 3. 常见模式：两行上英下中 / 上中下英 / 单行 / 多行（连续同类行合并）
 */

/** 判定一行是否为中文行（含 CJK 统一表意字符） */
export function isCJK(line: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿豈-﫿]/.test(line);
}

export interface BilingualText {
  textEn: string;
  textZh: string | null;
}

/** 将一个块的文本行拆分为英文/中文 */
export function splitBilingual(textLines: string[]): BilingualText {
  const lines = textLines.map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { textEn: '', textZh: null };

  if (lines.length === 1) {
    // 单行：按是否 CJK 决定归属
    return isCJK(lines[0])
      ? { textEn: '', textZh: lines[0] }
      : { textEn: lines[0], textZh: null };
  }

  if (lines.length === 2) {
    const [a, b] = lines;
    const aCjk = isCJK(a);
    const bCjk = isCJK(b);
    if (!aCjk && bCjk) return { textEn: a, textZh: b }; // 上英下中（本项目样本格式）
    if (aCjk && !bCjk) return { textEn: b, textZh: a }; // 上中下英 → 反序
    // 同类两行：并入英文或中文
    return aCjk
      ? { textEn: '', textZh: lines.join(' ') }
      : { textEn: lines.join(' '), textZh: null };
  }

  // 多行（>2）：连续英文行合并为 textEn，连续中文行合并为 textZh
  const enParts: string[] = [];
  const zhParts: string[] = [];
  for (const line of lines) {
    (isCJK(line) ? zhParts : enParts).push(line);
  }
  return {
    textEn: enParts.join(' '),
    textZh: zhParts.length > 0 ? zhParts.join(' ') : null
  };
}

/** 英文句子 → 词列表：按空格切分，剥离首尾标点，保留撇号（don't 为一个词） */
export function splitWords(textEn: string): string[] {
  return textEn
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    .filter(Boolean);
}
