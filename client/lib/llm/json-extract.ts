/**
 * LLM 输出的 JSON 提取/清洗共享件 —— chat-service（翻译数组）与 mnemonic-service
 * （助记对象）共用的容错栈，原先两份拷贝已漂移（助记侧缺「」引号处理）。
 *
 * 策略栈（按优先级）：
 *   1. stripJsonFence：剥掉 ```json 代码块包裹
 *   2. sliceJsonBlock：截取首个开括号至末个闭括号
 *   3. JSON.parse 原文
 *   4. sanitizeJsonString（CJK/智能引号归一）后重试，再不行 tryFixMalformedJson
 *
 * 注：不做全局 \n → \\n 转义 —— 字符串外的换行是合法空白，全局替换反而会把
 * 合法 JSON 弄坏；未转义换行的修复交给 tryFixMalformedJson 的字符串提取路径。
 */

/** 剥离 ```json … ``` 代码块包裹；无 fence 原样返回 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fence?.[1] ? fence[1].trim() : trimmed
}

/** 截取首个 open 至末个 close 的片段；找不到返回 null */
export function sliceJsonBlock(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  const end = text.lastIndexOf(close)
  if (start === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

// CJK 引号和智能引号的正则（使用 Unicode 转义避免编码问题）
const CJK_QUOTE_RE = /[「」“”‘’]/g
const CJK_QUOTE_TEST_RE = /[「」“”‘’]/

/**
 * 清洗模型返回中常见的 JSON 格式问题。
 * 本地小模型（7B 等）常犯的错误：
 *  - 使用「」“” ‘’ 替代标准双引号
 *  - 使用 CJK 右引号 」 替代 "," 分隔符
 */
export function sanitizeJsonString(raw: string): string {
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

/** 尝试修复格式严重损坏的 JSON：逐个提取引号包裹的字符串重组数组；无效返回 null */
export function tryFixMalformedJson(raw: string): unknown {
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
