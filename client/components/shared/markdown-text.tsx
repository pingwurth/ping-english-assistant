/**
 * 笔记 Markdown 渲染 —— 解析在 core/markdown/note-markdown.ts（含测试），这里只做结构 → JSX。
 *
 * 公式经 KaTeX 排版：JS 按需动态加载（笔记里出现 $ 才 import，全站只拉一次，
 * 无公式的笔记/页面零 JS 体积代价）；CSS 静态随本 chunk 引入，字体由浏览器按需取。
 * KaTeX 未就绪或渲染失败时降级为源码展示（throwOnError:false 时语法错误渲染为红色提示而非抛错）。
 */

import { useEffect, useState } from 'react'
import 'katex/dist/katex.min.css'
import { parseNoteMarkdown, tokenizeInline, type InlineToken, type NoteBlock, type NoteListItem } from '@/core/markdown/note-markdown'
import { getNoteImage, parseNoteImageRef } from '@/stores/note-image-store'
import { ImageLightbox } from '@/components/shared/image-lightbox'

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

/* ─── 笔记图片渲染 ───────────────────────────────────────────
 * idb://noteimg/ 引用 → blobs store 取 Blob → objectURL。会话级 LRU 缓存让
 * 同图重复渲染（滚动重挂载/编辑预览双份）不再读 IDB；外链 src 一律按纯文本
 * 处理（离线优先，且不给外部资源/注入面）。 */

/** blobKey → objectURL（Map 迭代序即 LRU 序：命中移尾、超限逐出最旧并 revoke） */
const objectUrlCache = new Map<string, string>()
const OBJECT_URL_CACHE_MAX = 80

function cachedObjectUrl(key: string, blob: Blob): string {
  const hit = objectUrlCache.get(key)
  if (hit !== undefined) {
    objectUrlCache.delete(key)
    objectUrlCache.set(key, hit)
    return hit
  }
  const url = URL.createObjectURL(blob)
  objectUrlCache.set(key, url)
  if (objectUrlCache.size > OBJECT_URL_CACHE_MAX) {
    const oldest = objectUrlCache.keys().next().value
    if (oldest !== undefined) {
      URL.revokeObjectURL(objectUrlCache.get(oldest)!)
      objectUrlCache.delete(oldest)
    }
  }
  return url
}

function NoteImage({ src, alt }: { src: string; alt: string }) {
  const ref = parseNoteImageRef(src)
  // 初值读缓存：已渲染过的图（如双栏预览先挂载过）直接出图，不再走 IDB
  const [url, setUrl] = useState<string | null>(() => (ref ? objectUrlCache.get(ref.blobKey) ?? null : null))
  const [failed, setFailed] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)
  const blobKey = ref?.blobKey ?? null
  useEffect(() => {
    if (!ref || url) return
    let alive = true
    getNoteImage(ref.materialId, ref.imageId)
      .then((blob) => {
        if (!alive) return
        if (blob) setUrl(cachedObjectUrl(ref.blobKey, blob))
        else setFailed(true)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
    // blobKey 为原始值：引用文本不变不重取；url 置位后守卫直接短路。
    // eslint 不在仓内；ref 每次渲染都是新对象，不能进依赖
  }, [blobKey, url])

  // 非本应用引用（外链等）：不加载，退化为可读文本
  if (!ref) return <span className="rounded-md bg-muted px-1 py-0.5 text-[0.85em] text-muted-foreground">{alt || src}</span>
  if (failed) return <span className="my-1 inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-xs text-muted-foreground">图片已失效{alt ? `（${alt}）` : ''}</span>
  if (!url) return <span className="my-1 inline-block h-16 w-40 animate-pulse rounded-lg bg-muted" aria-label="图片加载中" />
  return (
    <>
      <img
        src={url}
        alt={alt}
        title="点击查看大图（支持缩放）"
        loading="lazy"
        className="my-1 block max-h-[60vh] w-auto max-w-full cursor-zoom-in rounded-xl border"
        onClick={() => setZoomOpen(true)}
      />
      {zoomOpen && <ImageLightbox src={url} alt={alt} onClose={() => setZoomOpen(false)} />}
    </>
  )
}

function Inline({ tokens, katex }: { tokens: InlineToken[]; katex: KatexModule | null }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'bold': return <strong key={i} className="font-semibold">{t.text}</strong>
          case 'italic': return <em key={i}>{t.text}</em>
          case 'mark': return <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-400/25">{t.text}</mark>
          case 'code': return <code key={i} className="rounded-md bg-muted px-1 py-0.5 font-mono text-[0.85em]">{t.text}</code>
          case 'math': {
            const html = renderMath(t.text, t.display, katex)
            if (html === null) return <MathFallback key={i} text={t.text} display={t.display} />
            return t.display
              ? <span key={i} className="my-1 block overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
              : <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
          }
          case 'image': return <NoteImage key={i} src={t.src} alt={t.alt} />
          default: return <span key={i}>{t.text}</span>
        }
      })}
    </>
  )
}

/** 列表（含嵌套子层）：子层换 circle 圆点并留一点上边距，逐层递归 */
function NoteList({ items, katex, nested = false }: { items: NoteListItem[]; katex: KatexModule | null; nested?: boolean }) {
  return (
    <ul className={`${nested ? 'mt-1 list-circle ' : ''}list-disc space-y-1 pl-5`}>
      {items.map((item, i) => (
        <li key={i}>
          <Inline tokens={item.inline} katex={katex} />
          {item.children.length > 0 && <NoteList items={item.children} katex={katex} nested />}
        </li>
      ))}
    </ul>
  )
}

function Block({ block, katex }: { block: NoteBlock; katex: KatexModule | null }) {
  switch (block.type) {
    case 'heading': {
      const cls = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : ''
      return <p className={`font-semibold leading-snug ${cls}`}><Inline tokens={block.inline} katex={katex} /></p>
    }
    case 'list':
      return <NoteList items={block.items} katex={katex} />
    case 'quote':
      return <blockquote className="rounded-r-md border-l-2 border-primary/40 bg-purple-500/10 py-1 pl-3 text-purple-800 dark:text-purple-300">{block.lines.map((line, i) => <p key={i}><Inline tokens={line} katex={katex} /></p>)}</blockquote>
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

/** 行内 Markdown（**加粗** / *斜体* / ==高亮== / `代码` / 数学）：与笔记同一 canonical
 *  解析（note-markdown.tokenizeInline）与渲染（Inline），不产生块级包装 —— 供例句等
 *  行内场景使用（此前 mnemonic 页自造正则只认 **加粗**，其余记号渲染为原文）。 */
function InlineMarkdown({ src }: { src: string }) {
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
  return <Inline tokens={tokenizeInline(src)} katex={katex} />
}

export { MarkdownText, InlineMarkdown }
