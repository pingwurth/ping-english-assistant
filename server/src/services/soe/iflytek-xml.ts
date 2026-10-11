/**
 * 讯飞 ISE 结果 XML 解析 —— 零依赖正则属性提取（不加 XML 库）。
 * 决策：只取 5 个句级 + 3 个词级属性，开标签扫描对嵌套变化宽容。
 * 真实形态（msg.data.result 的 base64 分片拼接后）：
 *   <xml_result><read_sentence ...><rec_paper is_rejected="false" ...>
 *     <sentence total_score=".." accuracy_score=".." ...><word content=".." total_score=".." dp_message="..">
 *       <syll ...><phone .../></syll>   ← 音素级整体忽略
 */

export interface IflytekIseWord {
  text: string
  score: number
  dpMessage: number
}

export interface IflytekIseResult {
  /** rec_paper is_rejected：'true' 或 '1' 视为被拒（未识别出有效朗读） */
  isRejected: boolean
  total?: number
  accuracy?: number
  fluency?: number
  integrity?: number
  standard?: number
  words: IflytekIseWord[]
}

/** 从开标签片段提取字符串属性值；不存在返回 undefined */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`))
  return m?.[1]
}

/** 提取数值属性；缺失/空串返回 undefined */
function numAttr(tag: string, name: string): number | undefined {
  const v = attr(tag, name)
  if (v === undefined || v === '') return undefined
  return Number(v)
}

/** 最小 XML 实体还原（覆盖英文文本常见的 &#39;；&amp; 最后处理，避免二次解码） */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

export function parseIflytekResultXml(xml: string): IflytekIseResult {
  const result: IflytekIseResult = { isRejected: false, words: [] }

  const paper = xml.match(/<rec_paper\b[^>]*>/)
  if (paper) {
    const v = attr(paper[0] ?? '', 'is_rejected')
    result.isRejected = v === 'true' || v === '1'
  }

  const sentence = xml.match(/<sentence\b[^>]*>/)
  if (sentence) {
    const tag = sentence[0] ?? ''
    result.total = numAttr(tag, 'total_score')
    result.accuracy = numAttr(tag, 'accuracy_score')
    result.fluency = numAttr(tag, 'fluency_score')
    result.integrity = numAttr(tag, 'integrity_score')
    result.standard = numAttr(tag, 'standard_score')
  }

  // 只扫 <word 开标签；syll/phone 等嵌套元素整体忽略
  for (const m of xml.matchAll(/<word\b[^>]*>/g)) {
    const tag = m[0] ?? ''
    result.words.push({
      text: unescapeXml(attr(tag, 'content') ?? ''),
      score: numAttr(tag, 'total_score') ?? 0,
      dpMessage: numAttr(tag, 'dp_message') ?? 0,
    })
  }
  return result
}
