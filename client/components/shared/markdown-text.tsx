/**
 * 笔记 Markdown 渲染 —— 解析在 core/markdown/note-markdown.ts（含测试），这里只做结构 → JSX。
 */

import { parseNoteMarkdown, type InlineToken, type NoteBlock } from '@/core/markdown/note-markdown'

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'bold': return <strong key={i} className="font-semibold text-foreground">{t.text}</strong>
          case 'italic': return <em key={i}>{t.text}</em>
          case 'mark': return <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-400/25">{t.text}</mark>
          case 'code': return <code key={i} className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">{t.text}</code>
          default: return <span key={i}>{t.text}</span>
        }
      })}
    </>
  )
}

function Block({ block }: { block: NoteBlock }) {
  switch (block.type) {
    case 'heading': {
      const cls = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : ''
      return <p className={`font-semibold leading-snug ${cls}`}><Inline tokens={block.inline} /></p>
    }
    case 'list':
      return <ul className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><Inline tokens={item} /></li>)}</ul>
    case 'quote':
      return <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{block.lines.map((line, i) => <p key={i}><Inline tokens={line} /></p>)}</blockquote>
    case 'code':
      return <pre className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs leading-relaxed">{block.text}</pre>
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{block.header.map((cell, i) => <th key={i} className="border border-border bg-muted px-2 py-1 text-left font-semibold"><Inline tokens={cell} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="border border-border px-2 py-1"><Inline tokens={cell} /></td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )
    default:
      return <p className="leading-relaxed"><Inline tokens={block.inline} /></p>
  }
}

/** 渲染笔记 Markdown（解析失败不抛错，输入是纯文本总能渲染） */
function MarkdownText({ src, className = '' }: { src: string; className?: string }) {
  const blocks = parseNoteMarkdown(src)
  if (!blocks.length) return null
  return <div className={`flex flex-col gap-1.5 text-sm ${className}`}>{blocks.map((b, i) => <Block key={i} block={b} />)}</div>
}

export { MarkdownText }
