/**
 * 笔记 Markdown 迷你解析器 —— 零依赖纯 TS，node 可直接单测。
 *
 * 只覆盖笔记场景需要的子集（有意不做全 GFM）：
 *  - 行内：**粗体**、*斜体*、==高亮==、`行内码`、$行内公式$
 *  - 块级：# ~ ### 标题、- 列表、> 引用、``` 围栏代码块、| 表格（第二行为 --- 分隔行）、$$公式块$$、
 *          --- 分割线（3+ 个连续短横、星号或下划线；不做 setext 标题，段落后的 --- 就是分割线）、
 *          ::: center 居中容器（内嵌任意块级语法，::: 闭合；未闭合也成块）
 *
 * 公式记号只切分出 math token（LaTeX 源文本），真正的排版由渲染层交给 KaTeX；
 * 防货币误判规则：$ 内侧紧邻处不得是空白，且闭合 $ 后不得紧跟数字（Pandoc 同款启发式）。
 *
 * 空行规则（有意偏离 GFM 的折叠行为，笔记要所见即所得）：
 * 单个空行 = 块边界（同标准 Markdown）；连续 n≥2 个空行额外产出 spacer 块（lines = n-1），
 * 预览按一行文本高度 × lines 撑开。首尾空行、代码/公式块内部的空行不参与。
 *
 * 产出结构化 Block/InlineToken，由 components/shared/markdown-text.tsx 渲染，
 * 解析与渲染分离：解析规则变化只需改这里 + 补测试。
 */

/** 行内记号：按出现顺序切分，文本段为 text */
export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'italic'; text: string }
  | { type: 'mark'; text: string }
  | { type: 'code'; text: string }
  | { type: 'math'; text: string; display: boolean }

/** 块级结构 */
export type NoteBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineToken[] }
  | { type: 'paragraph'; inline: InlineToken[] }
  | { type: 'list'; items: InlineToken[][] }
  | { type: 'quote'; lines: InlineToken[][] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: InlineToken[][]; rows: InlineToken[][][] }
  | { type: 'math'; text: string }
  | { type: 'spacer'; lines: number }
  | { type: 'hr' }
  | { type: 'center'; blocks: NoteBlock[] }

/**
 * 行内记号切分：**粗** / *斜* / ==高亮== / `码` / $公式$
 * （先匹配到的先消费，** 优先于 *，$$ 优先于 $）
 */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  const re = /(\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*]+\*|\$\$[^$]+\$\$|\$[^$\s](?:[^$]*[^$\s])?\$(?!\d))/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) })
    else if (tok.startsWith('==')) out.push({ type: 'mark', text: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) })
    else if (tok.startsWith('$$')) out.push({ type: 'math', text: tok.slice(2, -2), display: true })
    else if (tok.startsWith('$')) out.push({ type: 'math', text: tok.slice(1, -1), display: false })
    else out.push({ type: 'italic', text: tok.slice(1, -1) })
    last = m.index + tok.length
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) })
  return out
}

/** 表格行拆单元格：去掉首尾竖线后按 | 切，单元格去首尾空白 */
function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

/** 分隔行判定：所有单元格都是 :---: / --- / - / :-: 形态（GFM 允许单短横，评审 #28） */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

/** 分割线：3+ 个连续同字符 - / * / _（GFM thematic break 的常用子集） */
const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/
/** 居中容器开行：:::+ 可选空白 center（大小写不敏感）；闭行：仅 ::: */
const CENTER_OPEN_RE = /^:::+\s*center\s*$/i
const CENTER_CLOSE_RE = /^:::+\s*$/

/** 解析笔记 Markdown 为块级结构；空串返回空数组 */
export function parseNoteMarkdown(src: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let list: InlineToken[][] = []
  let quote: InlineToken[][] = []
  let table: string[][] = []
  let code: string[] | null = null
  let math: string[] | null = null
  let center: string[] | null = null
  let blanks = 0

  /** 连续空行 ≥2 且前面已有内容：多余部分（n-1 行）转 spacer 块；任何非空行都会消费计数 */
  const emitSpacer = () => {
    if (blanks >= 2 && blocks.length > 0) blocks.push({ type: 'spacer', lines: blanks - 1 })
    blanks = 0
  }

  const flushList = () => {
    if (list.length) { blocks.push({ type: 'list', items: list }); list = [] }
  }
  const flushQuote = () => {
    if (quote.length) { blocks.push({ type: 'quote', lines: quote }); quote = [] }
  }
  const flushTable = () => {
    if (table.length) {
      const hasSep = table.length > 1 && isSeparatorRow(table[1]!)
      const header = (table[0] ?? []).map(tokenizeInline)
      const rows = (hasSep ? table.slice(2) : table.slice(1)).map((r) => r.map(tokenizeInline))
      blocks.push({ type: 'table', header, rows })
      table = []
    }
  }
  const flushAll = () => { flushList(); flushQuote(); flushTable() }

  for (const line of lines) {
    // 居中容器内：一切行都是内容（含 ```/$$/空行），递归解析交给闭合时
    if (center) {
      if (CENTER_CLOSE_RE.test(line.trim())) {
        blocks.push({ type: 'center', blocks: parseNoteMarkdown(center.join('\n')) })
        center = null
      } else center.push(line)
      continue
    }
    if (line.trim().startsWith('```')) {
      flushAll()
      emitSpacer()
      if (code) { blocks.push({ type: 'code', text: code.join('\n') }); code = null }
      else code = []
      continue
    }
    if (code) { code.push(line); continue }
    // 公式块内：等待闭合 $$（整行或行尾），空行不打断（LaTeX 允许多行）
    if (math) {
      const t = line.trim()
      if (t === '$$') { blocks.push({ type: 'math', text: math.join('\n') }); math = null }
      else if (t.endsWith('$$')) { math.push(t.slice(0, -2)); blocks.push({ type: 'math', text: math.join('\n') }); math = null }
      else math.push(line)
      continue
    }
    const t = line.trim()
    if (!t) { flushAll(); blanks++; continue }
    emitSpacer()

    // 分割线（先于表格/列表：独占一行的 --- 不可能是别的块）
    if (HR_RE.test(t)) { flushAll(); blocks.push({ type: 'hr' }); continue }
    // 居中容器开启
    if (CENTER_OPEN_RE.test(t)) { flushAll(); center = []; continue }

    // $$ 公式块：单行 $$..$$（内部无 $）直接成块；$$ 开启等待闭合；
    // 同行多个 $$..$$ 的复杂行走段落，由行内记号切成 display math。
    if (t.startsWith('$$')) {
      const inner = t.length > 4 && t.endsWith('$$') ? t.slice(2, -2) : null
      if (inner && !inner.includes('$')) {
        flushAll()
        blocks.push({ type: 'math', text: inner })
        continue
      }
      if (!t.slice(2).includes('$')) {
        flushAll()
        const rest = t.slice(2)
        math = rest ? [rest] : []
        continue
      }
      // 同行多个 $$..$$：落到段落，由行内记号切分
    }

    if (t.startsWith('|')) {
      flushList(); flushQuote()
      table.push(splitTableRow(t))
      continue
    }
    flushTable()

    if (t.startsWith('- ')) { flushQuote(); list.push(tokenizeInline(t.slice(2))); continue }
    if (t.startsWith('> ')) { flushList(); quote.push(tokenizeInline(t.slice(2))); continue }
    flushList(); flushQuote()

    if (t.startsWith('### ')) blocks.push({ type: 'heading', level: 3, inline: tokenizeInline(t.slice(4)) })
    else if (t.startsWith('## ')) blocks.push({ type: 'heading', level: 2, inline: tokenizeInline(t.slice(3)) })
    else if (t.startsWith('# ')) blocks.push({ type: 'heading', level: 1, inline: tokenizeInline(t.slice(2)) })
    else blocks.push({ type: 'paragraph', inline: tokenizeInline(t) })
  }
  flushAll()
  if (code) blocks.push({ type: 'code', text: code.join('\n') })
  if (math) blocks.push({ type: 'math', text: math.join('\n') })
  if (center) blocks.push({ type: 'center', blocks: parseNoteMarkdown(center.join('\n')) })
  return blocks
}
