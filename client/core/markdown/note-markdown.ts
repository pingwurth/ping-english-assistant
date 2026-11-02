/**
 * 笔记 Markdown 迷你解析器 —— 零依赖纯 TS，node 可直接单测。
 *
 * 只覆盖笔记场景需要的子集（有意不做全 GFM）：
 *  - 行内：**粗体**、*斜体*、==高亮==、`行内码`、$行内公式$
 *  - 块级：# ~ ### 标题、- 列表（嵌套：行首缩进每 2 空格 / 1 tab 计一级，跨级缺失收敛为上一项的直接子级）、
 *          > 引用、``` 围栏代码块、| 表格（第二行为 --- 分隔行）、$$公式块$$、
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

/** 列表项：内容 + 子项（行首缩进产生嵌套，2 空格 / 1 tab 计一级） */
export type NoteListItem = { inline: InlineToken[]; children: NoteListItem[] }

/** 块级结构 */
export type NoteBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineToken[] }
  | { type: 'paragraph'; inline: InlineToken[] }
  | { type: 'list'; items: NoteListItem[] }
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

/** enclosingCenter 的返回：容器四段字符区间（拆容器用） */
export interface EnclosingCenter {
  /** 容器整体起始（开行行首） */
  from: number
  /** 内容起始（开行换行后） */
  contentStart: number
  /** 内容结束（闭行换行前；未闭合容器到文末） */
  contentEnd: number
  /** 容器整体结束（闭行换行后；未闭合到文末） */
  to: number
}

/**
 * 定位选区所在的 ::: center 容器（工具栏「居中」取消动作用）；不在容器内返回 null。
 * 从选区首行向上找合法开行（中途先撞到闭合 ::: 则不在容器内；开行落在 ``` 围栏内
 * ——按围栏奇偶计数——视为代码内容跳过），再向下找闭合行（未闭合容器延伸到文末，
 * 与解析器一致）。选区跨过闭合行（选中了容器的一部分 + 容器外内容）返回 null。
 * 已知近似：$$ 公式块内的字面 ::: center 文本会误判（解析器同源限制，场景极罕见）。
 */
export function enclosingCenter(src: string, selStart: number, selEnd: number): EnclosingCenter | null {
  const lines: Array<[number, number]> = []
  let ls = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') { lines.push([ls, i]); ls = i + 1 }
  }
  lines.push([ls, src.length])
  const text = (i: number) => src.slice(lines[i]![0], lines[i]![1])
  /** pos 所在行（pos 落在行尾换行符上算该行） */
  const lineIndexAt = (pos: number): number => {
    const p = Math.min(Math.max(pos, 0), src.length)
    for (let i = 0; i < lines.length; i++) if (p <= lines[i]![1]) return i
    return lines.length - 1
  }
  /** idx 行之前（不含）的 ``` 围栏行数的奇偶——奇数意味着 idx 行在围栏内 */
  const fenceOddBefore = (idx: number): boolean => {
    let n = 0
    for (let i = 0; i < idx; i++) if (/^\s*```/.test(text(i))) n++
    return n % 2 === 1
  }

  const firstLine = lineIndexAt(selStart)
  let openIdx = -1
  for (let i = firstLine; i >= 0; i--) {
    const t = text(i).trim()
    if (CENTER_OPEN_RE.test(t)) {
      if (!fenceOddBefore(i)) { openIdx = i; break }
      continue // 围栏内的字面 ::: center 是代码内容，跳过继续向上
    }
    if (CENTER_CLOSE_RE.test(t)) return null
  }
  if (openIdx < 0) return null

  let closeIdx = -1
  for (let i = openIdx + 1; i < lines.length; i++) {
    const t = text(i).trim()
    if (CENTER_CLOSE_RE.test(t)) { closeIdx = i; break }
    if (CENTER_OPEN_RE.test(t)) return null // 嵌套开行：解析器不支持嵌套，保守判非
  }
  if (closeIdx >= 0 && lines[closeIdx]![0] < selEnd) return null // 闭合行落在选区内

  return {
    from: lines[openIdx]![0],
    contentStart: lines[openIdx]![1] + 1,
    // to 停在闭行行尾（不吞其换行）：闭行的换行充当内容与后文的分隔，
    // 与前侧保留的空行对称，拆容器后不会把内容与后文挤成相邻行
    contentEnd: closeIdx >= 0 ? lines[closeIdx]![0] - 1 : src.length,
    to: closeIdx >= 0 ? lines[closeIdx]![1] : src.length,
  }
}

/** 解析笔记 Markdown 为块级结构；空串返回空数组 */
export function parseNoteMarkdown(src: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  let listRoots: NoteListItem[] = []
  /** 列表项栈（含测得层级）：新项弹掉 ≥ 自身层级的栈项后挂到栈顶之下，首项缩进/跨级/回退由此收敛为合法树 */
  let listStack: { item: NoteListItem; level: number }[] = []
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
    if (listStack.length) { blocks.push({ type: 'list', items: listRoots }); listRoots = []; listStack = [] }
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

    if (t.startsWith('- ')) {
      flushQuote()
      // 嵌套层级：行首空白（tab 折算 2 空格）每 2 格一级；无父可挂（首项即缩进）→ 顶层，跨级缺失 → 挂栈顶直接子级
      const lead = /^[ \t]*/.exec(line)![0]!
      const level = Math.floor(lead.replace(/\t/g, '  ').length / 2)
      const item: NoteListItem = { inline: tokenizeInline(t.slice(2)), children: [] }
      while (listStack.length && listStack[listStack.length - 1]!.level >= level) listStack.pop()
      if (listStack.length) listStack[listStack.length - 1]!.item.children.push(item)
      else listRoots.push(item)
      listStack.push({ item, level })
      continue
    }
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
