/**
 * 句子笔记抽屉 —— 播放页"边听边记"的书写面（UI 定稿自 /prototype/sentence-notes 原型）。
 *
 * 形态：左侧开口（盖住媒体区，右侧字幕列表保持可见），右缘拖拽调宽（双击复位）；
 *       编辑/预览上下布局，中间分隔条拖拽调预览高度（双击复位，编辑器保底高度）。
 * 行为：内容受控（调用方负责持久化，抽屉本身不落盘）；打开期间锚定目标句不随播放切走；
 *       Esc / 点遮罩 / 完成 关闭；Markdown 支持 **粗** ==高亮== `码` $公式$ - 列表 > 引用 | 表格 --- 分割线 ::: center 居中。
 */

import { useEffect, useRef, useState } from 'react'
import { AlignCenter, Bold, Check, Code, Highlighter, List, Minus, Pencil, Play, Sigma, StickyNote, Table as TableIcon, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownText } from '@/components/shared/markdown-text'
import { formatDuration } from '@/components/shared/player-parts'
import type { SubtitleSentence } from '@/types/subtitle'

/** 抽屉宽度：默认 44vw，夹在 [MIN, MAX_RATIO×vw]；双击拖柄复位 */
const DEFAULT_WIDTH_RATIO = 0.44
const MIN_WIDTH = 360
const MAX_WIDTH_RATIO = 0.85
/** 预览区高度：初始按 编辑器:预览 = 1:2 计算（双击分隔条复位同款），最小 96px；
 *  上界由"编辑器保底 ~180px"动态夹紧——短视口时保底优先于 1:2 比例 */
const FALLBACK_PREVIEW_H = 220
const MIN_PREVIEW_H = 96
const MIN_EDITOR_H = 180
/** 分隔条竖向占位：h-2 + my-2（上下各 8px） */
const SEPARATOR_H = 24

const MD_PLACEHOLDER = '记点什么…（支持 Markdown：**粗** ==高亮== `代码` $公式$ - 列表 > 引用 | 表格 --- 分割线 居中）'
const CENTER_SNIPPET = '::: center\n居中文本\n:::'
const TABLE_SNIPPET = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |'

function defaultWidth(): number {
  if (typeof window === 'undefined') return 560
  return Math.max(MIN_WIDTH, Math.round(window.innerWidth * DEFAULT_WIDTH_RATIO))
}

function maxWidth(): number {
  if (typeof window === 'undefined') return 1080
  return Math.round(window.innerWidth * MAX_WIDTH_RATIO)
}

/** 主体内容盒高度：clientHeight 含 p-5 上下 padding，扣除后才是编辑器+分隔条+预览的分配空间 */
function contentHeightOf(el: HTMLDivElement | null): number {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
}

/**
 * 工具条 + 受控 textarea；wrapSelection 包选中文本，insertBlock 在光标处插整块（表格）。
 * 工具条 mousedown 阻止默认：焦点不离开编辑器——否则失焦状态下受控赋值会重置滚动位置
 * （跳顶/跳底），且 wrapSelection/insertBlock 里仍备份恢复 scrollTop 作保险。
 */
function NoteEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const wrapSelection = (before: string, after = before) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const st = el.scrollTop
    const sel = value.slice(s, e) || before.trim()
    const next = value.slice(0, s) + before + sel + after + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); el.scrollTop = st })
  }
  const insertBlock = (text: string) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const st = el.scrollTop
    const before = value.slice(0, s)
    // 光标（选区）之后的内容必须拼回，否则插入即截断；行尾原有的 \n 与插入块自带的
    // 收尾 \n 会叠成空行（连续两空行 → spacer），故吃掉开头一个
    const after = value.slice(e).replace(/^\n/, '')
    const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
    const next = before + prefix + text + '\n' + after
    onChange(next)
    // 光标落在插入块末尾、后续内容之前
    const caret = before.length + prefix.length + text.length + 1
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); el.scrollTop = st })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex items-center gap-0.5 text-muted-foreground" aria-label="格式工具条" onMouseDown={(e) => e.preventDefault()}>
        <Button variant="ghost" size="icon-xs" aria-label="加粗" title="加粗" onClick={() => wrapSelection('**')}><Bold /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="高亮" title="高亮" onClick={() => wrapSelection('==')}><Highlighter /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="行内代码" title="行内代码" onClick={() => wrapSelection('`')}><Code /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="公式" title="行内公式 $..$（独立成块的公式用 $$ 围栏）" onClick={() => wrapSelection('$')}><Sigma /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="列表" title="列表" onClick={() => wrapSelection('- ', '')}><List /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="插入表格" title="插入 3×2 表格" onClick={() => insertBlock(TABLE_SNIPPET)}><TableIcon /></Button>
        <Button variant="ghost" size="icon-xs" aria-label="插入分割线" title="插入水平分割线 ---" onClick={() => insertBlock('---')}><Minus /></Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="居中"
          title="居中：选中文本包裹 ::: center 容器，未选中插入模板"
          onClick={() => {
            const el = ref.current
            if (el && el.selectionStart !== el.selectionEnd) wrapSelection('::: center\n', '\n:::')
            else insertBlock(CENTER_SNIPPET)
          }}
        ><AlignCenter /></Button>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground/70">
          {value.trim() ? <><Check className="size-3 text-primary" aria-hidden />自动保存</> : 'Markdown'}
        </span>
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={MD_PLACEHOLDER}
        aria-label="笔记内容（Markdown）"
        className="min-h-0 flex-1 resize-none text-sm leading-relaxed"
      />
    </div>
  )
}

/**
 * 句子笔记抽屉。open 与 target 由调用方控制；onChange 每次按键触发（调用方本地即时更新 + 节流持久化），
 * onDelete 由底部按钮触发（清空内容 + 关闭由调用方决定，这里只上报）。
 */
function SentenceNoteDrawer({ open, target, content, onChange, onDelete, onLocate, onClose }: {
  open: boolean
  /** 锚定的目标句；open 期间不随播放切句变化 */
  target: SubtitleSentence | null
  content: string
  onChange: (v: string) => void
  onDelete: () => void
  /** 定位此句：跳转播放并关闭抽屉 */
  onLocate: () => void
  onClose: () => void
}) {
  // 抽屉宽度（右缘拖拽）
  const [width, setWidth] = useState(defaultWidth)
  const [draggingW, setDraggingW] = useState(false)
  const widthDrag = useRef<{ startX: number; startW: number } | null>(null)
  // 预览高度（分隔条拖拽）；null = 尚未初始化，首次打开时按 1:2 测量设定
  const [previewH, setPreviewH] = useState<number | null>(null)
  const [draggingH, setDraggingH] = useState(false)
  const heightDrag = useRef<{ startY: number; startH: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  /** 默认预览高：编辑器:预览 = 1:2（内容盒扣分隔条后按 1/3、2/3 分），再被
   *  [MIN_PREVIEW_H, 可用高 - 编辑器保底] 夹紧——短视口保底优先于比例 */
  const defaultPreviewH = () => {
    const bodyH = contentHeightOf(bodyRef.current)
    if (!bodyH) return FALLBACK_PREVIEW_H
    const usable = bodyH - SEPARATOR_H
    return Math.round(Math.max(MIN_PREVIEW_H, Math.min((usable * 2) / 3, usable - MIN_EDITOR_H)))
  }

  // 首次打开按实测高度设定初始比例；此后保留用户拖拽值，双击分隔条才重算复位
  useEffect(() => {
    if (open && previewH == null) setPreviewH(defaultPreviewH())
  }, [open, previewH])

  // Esc 关闭（抽屉打开时才监听）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !target) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`句子 ${target.index + 1} 的笔记`}
        className="absolute inset-y-0 left-0 flex flex-col bg-card shadow-2xl select-none"
        style={{ width: `${Math.min(width, maxWidth())}px`, userSelect: draggingW || draggingH ? 'none' : 'text' }}
      >
        {/* 头部：锚定句信息 */}
        <div className="border-b p-5 pr-12">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StickyNote className="size-3.5 text-primary" aria-hidden />
            句子笔记 · #{target.index + 1} · {formatDuration(target.startMs)}
            <button type="button" className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted" onClick={onLocate}>
              <Play className="size-3" aria-hidden />定位此句
            </button>
          </div>
          <p className="mt-2 text-base font-medium leading-relaxed">{target.textEn}</p>
          <p className="mt-1 text-sm text-muted-foreground">{target.textZh}</p>
        </div>

        {/* 主体：编辑器（占余高） + 分隔条 + 预览（拖拽定高） */}
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col p-5">
          <NoteEditor value={content} onChange={onChange} />
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="拖拽调整预览区高度"
            title="拖动调整预览高度（双击复位）"
            tabIndex={0}
            className="-mx-2 my-2 h-2 shrink-0 cursor-row-resize rounded-full transition-colors hover:bg-primary/25 data-[dragging=true]:bg-primary/50"
            data-dragging={draggingH ? 'true' : undefined}
            onDoubleClick={() => setPreviewH(defaultPreviewH())}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              heightDrag.current = { startY: e.clientY, startH: previewH ?? defaultPreviewH() }
              setDraggingH(true)
            }}
            onPointerMove={(e) => {
              const d = heightDrag.current
              if (!d) return
              const bodyH = contentHeightOf(bodyRef.current)
              const max = Math.max(MIN_PREVIEW_H, bodyH - SEPARATOR_H - MIN_EDITOR_H)
              setPreviewH(Math.max(MIN_PREVIEW_H, Math.min(max, d.startH - (e.clientY - d.startY))))
            }}
            onPointerUp={() => { heightDrag.current = null; setDraggingH(false) }}
          />
          <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30" style={{ height: `${previewH ?? FALLBACK_PREVIEW_H}px` }}>
            <p className="border-b bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">实时预览</p>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {content.trim()
                ? <MarkdownText src={content} />
                : <p className="text-sm text-muted-foreground">上方开始输入，这里实时显示 Markdown 渲染效果（支持表格与公式）</p>}
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="hidden md:inline">拖动抽屉右缘调宽度 · 拖动分隔条调预览高度</span>
          <span className="md:hidden">拖动右缘/分隔条调整</span>
          <span className="flex-1" />
          {content.trim() && (
            <Button variant="ghost" size="xs" onClick={onDelete}><Trash2 data-icon="inline-start" />删除本句笔记</Button>
          )}
          <Button size="sm" onClick={onClose}>完成</Button>
        </div>

        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="关闭笔记">
          <X className="size-4" aria-hidden />
        </button>

        {/* 右缘宽度拖拽柄 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整抽屉宽度"
          title="拖动调整宽度（双击复位）"
          tabIndex={0}
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-primary/40 data-[dragging=true]:bg-primary/60"
          data-dragging={draggingW ? 'true' : undefined}
          onDoubleClick={() => setWidth(defaultWidth())}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            widthDrag.current = { startX: e.clientX, startW: width }
            setDraggingW(true)
          }}
          onPointerMove={(e) => {
            const d = widthDrag.current
            if (!d) return
            setWidth(Math.max(MIN_WIDTH, Math.min(maxWidth(), d.startW + (e.clientX - d.startX))))
          }}
          onPointerUp={() => { widthDrag.current = null; setDraggingW(false) }}
        />
      </div>
    </div>
  )
}

export { SentenceNoteDrawer }
