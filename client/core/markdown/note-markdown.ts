/**
 * 笔记 Markdown 迷你解析器 —— 零依赖纯 TS，node 可直接单测。
 *
 * 只覆盖笔记场景需要的子集（有意不做全 GFM）：
 *  - 行内：**粗体**、*斜体*、==高亮==、`行内码`
 *  - 块级：# ~ ### 标题、- 列表、> 引用、``` 围栏代码块、| 表格（第二行为 --- 分隔行）
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

/** 块级结构 */
export type NoteBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineToken[] }
  | { type: 'paragraph'; inline: InlineToken[] }
  | { type: 'list'; items: InlineToken[][] }
  | { type: 'quote'; lines: InlineToken[][] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: InlineToken[][]; rows: InlineToken[][][] }

/** 行内记号切分：**粗** / *斜* / ==高亮== / `码`（先匹配到的先消费，** 优先于 *） */
export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  const re = /(\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) out.push({ type: 'bold', text: tok.slice(2, -2) })
    else if (tok.startsWith('==')) out.push({ type: 'mark', text: tok.slice(2, -2) })
    else if (tok.startsWith('`')) out.push({ type: 'code', text: tok.slice(1, -1) })
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

/** 分隔行判定：所有单元格都是 :---: / --- / :--- 形态 */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c))
}

/** 解析笔记 Markdown 为块级结构；空串返回空数组 */
export function parseNoteMarkdown(src: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let list: InlineToken[][] = []
  let quote: InlineToken[][] = []
  let table: string[][] = []
  let code: string[] | null = null

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
    if (line.trim().startsWith('```')) {
      flushAll()
      if (code) { blocks.push({ type: 'code', text: code.join('\n') }); code = null }
      else code = []
      continue
    }
    if (code) { code.push(line); continue }
    const t = line.trim()
    if (!t) { flushAll(); continue }

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
  return blocks
}
