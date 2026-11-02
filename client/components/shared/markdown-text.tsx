/**
 * 笔记 Markdown 渲染 —— 解析在 core/markdown/note-markdown.ts（含测试），这里只做结构 → JSX。
 *
 * 公式经 KaTeX 排版：JS 按需动态加载（笔记里出现 $ 才 import，全站只拉一次，
 * 无公式的笔记/页面零 JS 体积代价）；CSS 静态随本 chunk 引入，字体由浏览器按需取。
 * KaTeX 未就绪或渲染失败时降级为源码展示（throwOnError:false 时语法错误渲染为红色提示而非抛错）。
 */

import { useEffect, useState } from 'react'
import 'katex/dist/katex.min.css'
import { parseNoteMarkdown, type InlineToken, type NoteBlock } from '@/core/markdown/note-markdown'

type KatexModule = (typeof import('katex'))['default']

/** KaTeX 单例加载 Promise（失败允许重试：置空下次再拉） */
let katexLoading: Promise<KatexModule> | null = null
function loadKatex(): Promise<KatexModule> {
  katexLoading ??= import('katex').then((m) => m.default)
  return katexLoading
}

/** 公式 → HTML；katex 未就绪返回 null，调用方降级显示源码 */
function renderMath(text: string, display: boolean, katex: KatexModule | null): string | null {
  if (!katex) return null
  try {
    return katex.renderToString(text, { displayMode: display, throwOnError: false, strict: 'ignore' })
  } catch {
    return null
  }
}

/** 源码降级样式：与行内码一致，保持等宽可读 */
function MathFallback({ text, display }: { text: string; display?: boolean }) {
  const src = display ? `$$${text}$$` : `$${text}$`
  return <code className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">{src}</code>
}

function Inline({ tokens, katex }: { tokens: InlineToken[]; katex: KatexModule | null }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'bold': return <strong key={i} className="font-semibold text-foreground">{t.text}</strong>
          case 'italic': return <em key={i}>{t.text}</em>
          case 'mark': return <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-400/25">{t.text}</mark>
          case 'code': return <code key={i} className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">{t.text}</code>
          case 'math': {
            const html = renderMath(t.text, t.display, katex)
            if (html === null) return <MathFallback key={i} text={t.text} display={t.display} />
            return t.display
              ? <span key={i} className="my-1 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
              : <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
          }
          default: return <span key={i}>{t.text}</span>
        }
      })}
    </>
  )
}

function Block({ block, katex }: { block: NoteBlock; katex: KatexModule | null }) {
  switch (block.type) {
    case 'heading': {
      const cls = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : ''
      return <p className={`font-semibold leading-snug ${cls}`}><Inline tokens={block.inline} katex={katex} /></p>
    }
    case 'list':
      return <ul className="list-disc space-y-1 pl-5">{block.items.map((item, i) => <li key={i}><Inline tokens={item} katex={katex} /></li>)}</ul>
    case 'quote':
      return <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{block.lines.map((line, i) => <p key={i}><Inline tokens={line} katex={katex} /></p>)}</blockquote>
    case 'code':
      return <pre className="overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs leading-relaxed">{block.text}</pre>
    case 'math': {
      const html = renderMath(block.text, true, katex)
      if (html === null) return <div className="my-1"><MathFallback text={block.text} display /></div>
      return <div className="my-1 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
    }
    case 'spacer':
      // 多余空行：每个额外空行撑起一行文本高度（1.625em = leading-relaxed × text-sm）
      return <div aria-hidden style={{ height: `${block.lines * 1.625}em` }} />
    case 'hr':
      return <hr className="my-2 h-px shrink-0 border-0 bg-border" />
    case 'center':
      return <div className="text-center">{block.blocks.map((b, i) => <Block key={i} block={b} katex={katex} />)}</div>
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{block.header.map((cell, i) => <th key={i} className="border border-border bg-muted px-2 py-1 text-left font-semibold"><Inline tokens={cell} katex={katex} /></th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="border border-border px-2 py-1"><Inline tokens={cell} katex={katex} /></td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )
    default:
      return <p className="leading-relaxed"><Inline tokens={block.inline} katex={katex} /></p>
  }
}

/** 渲染笔记 Markdown（解析失败不抛错，输入是纯文本总能渲染） */
function MarkdownText({ src, className = '' }: { src: string; className?: string }) {
  // hooks 必须在提前 return 之前（组件下方有 !blocks.length 的早退）
  const [katex, setKatex] = useState<KatexModule | null>(null)
  const hasMath = src.includes('$')
  useEffect(() => {
    if (!hasMath || katex) return
    let alive = true
    loadKatex()
      .then((k) => { if (alive) setKatex(k) })
      .catch(() => { katexLoading = null })
    return () => { alive = false }
  }, [hasMath, katex])

  const blocks = parseNoteMarkdown(src)
  if (!blocks.length) return null
  return <div className={`flex flex-col gap-1.5 text-sm ${className}`}>{blocks.map((b, i) => <Block key={i} block={b} katex={katex} />)}</div>
}

export { MarkdownText }
