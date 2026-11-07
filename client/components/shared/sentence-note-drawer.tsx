/**
 * 句子笔记抽屉 —— 播放页"边听边记"的书写面（UI 定稿自 /prototype/sentence-notes 原型）。
 *
 * 形态：底部弹出（盖住页面下方，上方播放区保持可见），上缘拖拽调高（双击复位）；
 *       编辑/预览左右分栏（窄屏 <768px 退回上下分栏），视图三态：仅编辑/双栏/仅预览，
 *       弹出时按内容定初始视图——空笔记直接进编辑、已有笔记先看预览，此后可手动切换（会话内保留）；
 *       分隔条拖拽调预览占比（双击复位，编辑器保底），左右默认 1:1、上下默认 1:2。
 * 行为：内容受控（调用方负责持久化，抽屉本身不落盘）；打开期间锚定目标句不随播放切走；
 *       Esc / 点遮罩 / 完成 关闭；双栏下编辑/预览滚动按百分比互同步（先滚的一侧持有同步权，
 *       静止 120ms 释放，对端回声被吞——无反馈循环）；
 *       Markdown 支持 **粗** ==高亮== `码` $公式$ - 列表（缩进嵌套）> 引用 | 表格 --- 分割线 ::: center 居中
 *       ![图片]（工具条按钮 / 直接粘贴 / 拖入文件；压缩后存本地 IDB，随完整备份导出）；
 *       编辑器列表行回车自动续行（继承缩进与前缀，空项回车退出），Tab / Shift+Tab 整行缩进 / 回退一级。
 */

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { AlignCenter, Bold, Check, Code, Columns2, Highlighter, Image as ImageIcon, List, Minus, PanelLeft, PanelRight, Pencil, Play, Sigma, StickyNote, Table as TableIcon, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownText } from '@/components/shared/markdown-text'
import { enclosingCenter } from '@/core/markdown/note-markdown'
import { compressImage } from '@/platform/image/compress-image'
import { noteImageRef, putNoteImage } from '@/stores/note-image-store'
import { formatDuration } from '@/components/shared/player-parts'
import type { SubtitleSentence } from '@/types/subtitle'

/** 抽屉高度：默认 90vh，夹在 [MIN, MAX_RATIO×vh]（上限略高于默认值，上拖仍有余量）；双击拖柄复位 */
const DEFAULT_HEIGHT_RATIO = 0.9
const MIN_HEIGHT = 360
const MAX_HEIGHT_RATIO = 0.95
/** 预览区高度（窄屏上下分栏用）：初始按 编辑器:预览 = 1:2 计算（双击分隔条复位同款），
 *  最小 96px；上界由"编辑器保底 ~180px"动态夹紧——短视口时保底优先于 1:2 比例 */
const FALLBACK_PREVIEW_H = 220
const MIN_PREVIEW_H = 96
const MIN_EDITOR_H = 180
/** 分隔条沿分轴的占位：h-2/w-2 + my-2/mx-2（两侧各 8px），上下/左右同宽 */
const SEPARATOR_H = 24
const SEPARATOR_W = 24
/** 预览区宽度（宽屏左右分栏用）：初始 1:1 对半；夹在 [MIN_PREVIEW_W, 可用宽-编辑器保底]，
 *  可用宽不足两者之和（极窄抽屉）时退化为对半——不溢出优先于保底 */
const FALLBACK_PREVIEW_W = 260
const MIN_PREVIEW_W = 220
const MIN_EDITOR_W = 280

/** 视图三态：仅编辑 / 编辑+预览 / 仅预览 */
type NoteViewMode = 'editor' | 'split' | 'preview'

const MD_PLACEHOLDER = '记点什么…（支持 Markdown：**粗** ==高亮== `代码` $公式$ - 列表 > 引用 | 表格 --- 分割线 居中）'
const CENTER_SNIPPET = '::: center\n居中文本\n:::'
const TABLE_SNIPPET = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |'

function defaultHeight(): number {
  if (typeof window === 'undefined') return 560
  return Math.max(MIN_HEIGHT, Math.round(window.innerHeight * DEFAULT_HEIGHT_RATIO))
}

function maxHeight(): number {
  if (typeof window === 'undefined') return 720
  return Math.round(window.innerHeight * MAX_HEIGHT_RATIO)
}

/** 主体内容盒高度：clientHeight 含 p-5 上下 padding，扣除后才是编辑器+分隔条+预览的分配空间 */
function contentHeightOf(el: HTMLDivElement | null): number {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
}

/** 主体内容盒宽度：同 contentHeightOf，左右 padding 扣除后才是左右分栏的分配空间 */
function contentWidthOf(el: HTMLDivElement | null): number {
  if (!el) return 0
  const cs = getComputedStyle(el)
  return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
}

/**
 * 工具条 + 受控 textarea；wrapSelection 是 toggle：选区已带效果（记号紧贴选区外侧，
 * 或选区自身完整含记号）则去记号取消，否则包裹；insertBlock 在光标处插整块（表格/图片）。
 * 图片插入（按钮/粘贴/拖拽共用）：compressImage 压缩 → blobs store 入库 → 光标处插
 * `![alt](idb://noteimg/…)` 引用；压缩/入库是异步的，拼接须用 valueRef 里的最新内容，
 * 否则闭包 value 是点击时的旧值，期间的键入会被吞。
 * 工具条 mousedown 阻止默认：焦点不离开编辑器——否则失焦状态下受控赋值会重置滚动位置
 * （跳顶/跳底），且 wrapSelection/insertBlock 里仍备份恢复 scrollTop 作保险。
 * 键盘增强见 onKeyDown：列表回车续行 / 空项退出 / Tab 整行缩进（IME 组合中不拦截）。
 */
function NoteEditor({ value, onChange, inputRef, onInputScroll, materialId }: {
  value: string
  onChange: (v: string) => void
  /** 编辑器 textarea 的外部 ref（滚动同步需要反向设置编辑器滚动位置） */
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
  /** textarea 滚动回调（抽屉用于百分比同步到预览区） */
  onInputScroll?: (el: HTMLTextAreaElement) => void
  /** 图片归属材料（noteimg 键按材料隔离，随材料删除级联） */
  materialId: string
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const ref = inputRef ?? localRef
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [imgBusy, setImgBusy] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)
  // 异步插入的安全镜像：图片压缩/入库完成时读最新内容（见上）
  const valueRef = useRef(value)
  valueRef.current = value
  const wrapSelection = (before: string, after = before) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const st = el.scrollTop
    const sel = value.slice(s, e)
    // 取消判定：a) 记号紧贴选区外侧（**[选区]**）b) 选区自身完整含记号（选中 **文本**）
    const outer = s >= before.length && value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after
    const self = sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)
    if (outer || self) {
      const core = outer ? sel : sel.slice(before.length, sel.length - after.length)
      const cutStart = outer ? s - before.length : s
      const cutEnd = outer ? e + after.length : e
      onChange(value.slice(0, cutStart) + core + value.slice(cutEnd))
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cutStart, cutStart + core.length); el.scrollTop = st })
      return
    }
    // 包裹（无选区 → 插入空记号对，光标落在中间）
    onChange(value.slice(0, s) + before + sel + after + value.slice(e))
    const cs = s + before.length
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cs, cs + sel.length); el.scrollTop = st })
  }
  const insertBlock = (text: string, base: string = value) => {
    const el = ref.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const st = el.scrollTop
    const before = base.slice(0, s)
    // 光标（选区）之后的内容必须拼回，否则插入即截断；行尾原有的 \n 与插入块自带的
    // 收尾 \n 会叠成空行（连续两空行 → spacer），故吃掉开头一个
    const after = base.slice(e).replace(/^\n/, '')
    const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
    const next = before + prefix + text + '\n' + after
    onChange(next)
    // 光标落在插入块末尾、后续内容之前
    const caret = before.length + prefix.length + text.length + 1
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); el.scrollTop = st })
  }

  /** 图片入库 + 插入引用（按钮/粘贴/拖拽共用）；失败在工具条状态位短提示，不打断书写 */
  const insertImages = async (files: ReadonlyArray<File>) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0 || imgBusy) return
    setImgBusy(true)
    setImgError(null)
    try {
      const marks: string[] = []
      for (const f of images) {
        const blob = await compressImage(f)
        const imageId = await putNoteImage(materialId, blob)
        // alt 取文件名（去扩展名、去 [] 记号字符），无名/清空后回落「图片」
        const alt = f.name.replace(/\.[^.]*$/, '').replace(/[[\]]/g, '').trim() || '图片'
        marks.push(`![${alt}](${noteImageRef(materialId, imageId)})`)
      }
      insertBlock(marks.join('\n\n'), valueRef.current)
    } catch (e) {
      setImgError(e instanceof Error ? e.message : '图片插入失败')
      setTimeout(() => setImgError(null), 4000)
    } finally {
      setImgBusy(false)
    }
  }
  /**
   * 键盘增强（IME 组合中不拦——回车是确认候选词；缩进单位与解析器一致：2 空格一级）：
   *  Enter：列表行续行（继承缩进与 '- ' 前缀，光标后内容落到新行）；空列表项回车 = 退出列表；
   *         Shift+Enter 及带修饰键的回车保持原生行为。
   *  Tab / Shift+Tab：当前行整体缩进 / 回退一级（1 个 tab 视作 2 空格），嵌套列表的主要调整手段。
   * 与工具条一致走手工拼接 + rAF 恢复光标与 scrollTop（撤销栈行为同工具条操作）。
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    const el = ref.current
    if (!el || (e.key !== 'Enter' && e.key !== 'Tab')) return
    const { selectionStart: s, selectionEnd: sel } = el
    const st = el.scrollTop
    const lineStart = value.slice(0, s).lastIndexOf('\n') + 1

    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        // 回退：去掉行首 1 个 tab 或至多 2 个空格；无可退则不动
        const cut = value.startsWith('\t', lineStart) ? 1 : /^[ ]{1,2}/.exec(value.slice(lineStart))?.[0].length ?? 0
        if (!cut) return
        onChange(value.slice(0, lineStart) + value.slice(lineStart + cut))
        const ns = Math.max(lineStart, s - cut)
        const ne = Math.max(ns, sel - cut)
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ns, ne); el.scrollTop = st })
      } else {
        onChange(value.slice(0, lineStart) + '  ' + value.slice(lineStart))
        requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + 2, sel + 2); el.scrollTop = st })
      }
      return
    }

    // Enter：带修饰键（Shift+Enter 原生换行等）不处理
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return
    const nl = value.indexOf('\n', sel)
    const lineEnd = nl === -1 ? value.length : nl
    const fullLine = value.slice(lineStart, lineEnd)
    // 空列表项（只有缩进 + '-' 无内容）：回车退出列表——整行换成空行，光标落空行
    if (/^[ \t]*-[ \t]*$/.test(fullLine)) {
      e.preventDefault()
      onChange(value.slice(0, lineStart) + '\n' + value.slice(lineEnd + 1))
      const caret = lineStart + 1
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); el.scrollTop = st })
      return
    }
    // 列表行：续行继承缩进 + '- '；光标后内容经 after 拼接自然落到新行
    const m = /^([ \t]*)- /.exec(fullLine)
    if (m) {
      e.preventDefault()
      const insert = `\n${m[1]!}- `
      onChange(value.slice(0, s) + insert + value.slice(sel))
      const caret = s + insert.length
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); el.scrollTop = st })
    }
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
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
          aria-label="插入图片"
          title="插入图片（也可直接粘贴或拖入图片文件）"
          disabled={imgBusy}
          onClick={() => fileInputRef.current?.click()}
        ><ImageIcon /></Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { void insertImages(Array.from(e.target.files ?? [])); e.target.value = '' }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="居中"
          title="居中：选中文本包裹 ::: center 容器；已在容器内则取消居中；未选中插入模板"
          onClick={() => {
            const el = ref.current
            if (!el) return
            const { selectionStart: s, selectionEnd: e } = el
            const st = el.scrollTop
            // 已在居中容器内（选区任意位置）→ 拆掉容器取消居中，内容与选区保留
            const enc = enclosingCenter(value, s, e)
            if (enc) {
              const inner = value.slice(enc.contentStart, enc.contentEnd)
              onChange(value.slice(0, enc.from) + inner + value.slice(enc.to))
              const shift = enc.contentStart - enc.from
              const ns = Math.max(enc.from, s - shift)
              const ne = Math.max(ns, Math.min(enc.from + inner.length, e - shift))
              requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ns, ne); el.scrollTop = st })
              return
            }
            if (s !== e) wrapSelection('::: center\n', '\n:::')
            else insertBlock(CENTER_SNIPPET)
          }}
        ><AlignCenter /></Button>
        <span className="ml-auto flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/70" role="status">
          {imgError
            ? <span className="truncate text-destructive" title={imgError}>{imgError}</span>
            : imgBusy
              ? <span className="whitespace-nowrap">正在处理图片…</span>
              : value.trim() ? <><Check className="size-3 shrink-0 text-primary" aria-hidden />自动保存</> : 'Markdown'}
        </span>
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => onInputScroll?.(e.currentTarget)}
        onPaste={(e) => {
          // 粘贴图片文件：截图工作流的主路径；纯文本粘贴保持原生行为
          const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
          if (files.length > 0) { e.preventDefault(); void insertImages(files) }
        }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
          if (files.length > 0) { e.preventDefault(); void insertImages(files) }
        }}
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
function SentenceNoteDrawer({ open, target, content, onChange, onDelete, onLocate, onClose, materialId }: {
  open: boolean
  /** 锚定的目标句；open 期间不随播放切句变化 */
  target: SubtitleSentence | null
  content: string
  onChange: (v: string) => void
  onDelete: () => void
  /** 定位此句：跳转播放并关闭抽屉 */
  onLocate: () => void
  onClose: () => void
  /** 图片归属材料（noteimg 键按材料隔离） */
  materialId: string
}) {
  // 视图三态（仅编辑 / 双栏 / 仅预览）；每次弹出按内容定初态，打开期间的手动切换会话内保留，不落盘
  const [mode, setMode] = useState<NoteViewMode>('split')
  // 窄屏（<768px，与页脚提示的 md: 断点一致）：双栏退回上下布局——手机上左右放不下
  const [narrow, setNarrow] = useState(false)
  // 抽屉高度（上缘拖拽）
  const [height, setHeight] = useState(defaultHeight)
  const [draggingHeight, setDraggingHeight] = useState(false)
  const edgeDrag = useRef<{ startY: number; startH: number } | null>(null)
  // 预览高度（窄屏上下分栏，分隔条拖拽）；null = 尚未初始化，首次打开时按 1:2 测量设定
  const [previewH, setPreviewH] = useState<number | null>(null)
  const [draggingPH, setDraggingPH] = useState(false)
  const phDrag = useRef<{ startY: number; startH: number } | null>(null)
  // 预览宽度（宽屏左右分栏，分隔条拖拽）；null = 尚未初始化，首次打开时按 1:1 测量设定
  const [previewW, setPreviewW] = useState<number | null>(null)
  const [draggingPW, setDraggingPW] = useState(false)
  const pwDrag = useRef<{ startX: number; startW: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // 滚动同步（双栏下按百分比互镜像）：editorEl/previewEl 为两栏的滚动容器
  const editorScrollRef = useRef<HTMLTextAreaElement | null>(null)
  const previewScrollRef = useRef<HTMLDivElement | null>(null)
  /** 当前持有同步权的一侧：持有期间对端的 scroll 事件视作程序化设置的回声，直接吞掉；
   *  静止 120ms 释放——避免 A→B→A 反馈循环与往复漂移 */
  const syncOwner = useRef<'editor' | 'preview' | null>(null)
  const syncRelease = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 按百分比同步两栏滚动位置：from 侧滚动 → 设置 target 侧同比例 scrollTop */
  const syncScroll = (from: 'editor' | 'preview', el: HTMLElement) => {
    if (mode !== 'split') return
    if (syncOwner.current && syncOwner.current !== from) return
    const target = from === 'editor' ? previewScrollRef.current : editorScrollRef.current
    if (!target) return
    const elMax = el.scrollHeight - el.clientHeight
    const tgMax = target.scrollHeight - target.clientHeight
    // 先占权再设置：个别浏览器 scrollTop 赋值可能同步派发 scroll，占权晚了会误吞本侧
    syncOwner.current = from
    if (syncRelease.current) clearTimeout(syncRelease.current)
    syncRelease.current = setTimeout(() => { syncOwner.current = null }, 120)
    if (elMax > 0 && tgMax > 0) target.scrollTop = (el.scrollTop / elMax) * tgMax
  }

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // 窄/宽切换时重夹上一布局留下的定尺寸——否则桌面高度下定的 previewH 会撑爆
  // 窄屏内容盒，把编辑器压没（previewW 同理反向）；进出双栏（mode 变化）时同样
  // 重夹：单栏期间主体盒尺寸变化不会被察觉；夹紧幂等，正常值不受影响
  useEffect(() => {
    setPreviewH((h) => (h == null ? h : clampPreviewH(h)))
    setPreviewW((w) => (w == null ? w : clampPreviewW(w)))
  }, [narrow, mode])

  /** 预览高夹紧：[MIN_PREVIEW_H, 可用高 - 编辑器保底]（可用高不足时上界退到下界）；
   *  主体盒不可测（抽屉未开、ref 脱挂）时原值返回——夹紧须幂等收敛，不能把好值改坏 */
  const clampPreviewH = (h: number): number => {
    const usable = contentHeightOf(bodyRef.current) - SEPARATOR_H
    if (usable <= 0) return h
    const max = Math.max(MIN_PREVIEW_H, usable - MIN_EDITOR_H)
    return Math.round(Math.max(MIN_PREVIEW_H, Math.min(max, h)))
  }

  /** 默认预览高：编辑器:预览 = 1:2（内容盒扣分隔条后按 1/3、2/3 分），再夹紧 */
  const defaultPreviewH = () => {
    const bodyH = contentHeightOf(bodyRef.current)
    if (!bodyH) return FALLBACK_PREVIEW_H
    return clampPreviewH(((bodyH - SEPARATOR_H) * 2) / 3)
  }

  /** 预览宽夹紧：常规夹在 [MIN_PREVIEW_W, 可用宽 - 编辑器保底]；可用宽不足两者之和
   *  （极窄抽屉）时下界退化为对半——不溢出优先于保底；主体盒不可测时原值返回（同 clampPreviewH） */
  const clampPreviewW = (w: number): number => {
    const usable = contentWidthOf(bodyRef.current) - SEPARATOR_W
    if (usable <= 0) return w
    const min = Math.min(MIN_PREVIEW_W, Math.round(usable / 2))
    const max = Math.max(min, usable - MIN_EDITOR_W)
    return Math.round(Math.max(min, Math.min(max, w)))
  }

  /** 默认预览宽：编辑器:预览 = 1:1 对半，再经 clampPreviewW 夹紧 */
  const defaultPreviewW = () => clampPreviewW((contentWidthOf(bodyRef.current) - SEPARATOR_W) / 2)

  // 弹出瞬间按当时内容定初始视图（渲染期同步设定，避免先渲染默认 split 再切换的一帧闪烁）：
  // 空笔记 → 仅编辑（直接写），已有笔记 → 仅预览（先读）；关闭后再弹出则按新内容重新判定
  const wasOpenRef = useRef(false)
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open
    if (open) setMode(content.trim() ? 'preview' : 'editor')
  }

  // 首次打开按实测尺寸设定初始比例；此后保留用户拖拽值，双击分隔条才重算复位
  useEffect(() => {
    if (!open) return
    if (previewH == null) setPreviewH(defaultPreviewH())
    if (previewW == null) setPreviewW(defaultPreviewW())
  }, [open, previewH, previewW])

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
        className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl select-none"
        style={{ height: `${Math.min(height, maxHeight())}px`, userSelect: draggingHeight || draggingPH || draggingPW ? 'none' : 'text' }}
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

        {/* 主体：视图三态切换 + 编辑/预览双栏（宽屏左右、窄屏上下） */}
        <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col p-5">
          {/* 视图切换必须放在两栏之外——仅编辑/仅预览模式下工具条或预览头任一可能不渲染 */}
          <div className="mb-2 flex shrink-0 items-center justify-end gap-0.5" role="group" aria-label="视图模式">
            <Button variant={mode === 'editor' ? 'secondary' : 'ghost'} size="icon-xs" aria-label="仅显示编辑区" title="仅显示编辑区" aria-pressed={mode === 'editor'} onClick={() => setMode('editor')}><PanelLeft /></Button>
            <Button variant={mode === 'split' ? 'secondary' : 'ghost'} size="icon-xs" aria-label="编辑加预览" title="编辑 + 预览双栏（窄屏上下）" aria-pressed={mode === 'split'} onClick={() => setMode('split')}><Columns2 /></Button>
            <Button variant={mode === 'preview' ? 'secondary' : 'ghost'} size="icon-xs" aria-label="仅显示预览区" title="仅显示预览区" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><PanelRight /></Button>
          </div>

          <div className={`flex min-h-0 flex-1 ${narrow ? 'flex-col' : 'flex-row'}`}>
            {mode !== 'preview' && <NoteEditor value={content} onChange={onChange} inputRef={editorScrollRef} onInputScroll={(el) => syncScroll('editor', el)} materialId={materialId} />}

            {mode === 'split' && !narrow && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖拽调整预览区宽度"
                title="拖动调整预览宽度（双击复位）"
                tabIndex={0}
                className="-my-2 mx-2 w-2 shrink-0 cursor-col-resize rounded-full transition-colors hover:bg-primary/25 data-[dragging=true]:bg-primary/50"
                data-dragging={draggingPW ? 'true' : undefined}
                onDoubleClick={() => setPreviewW(defaultPreviewW())}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  pwDrag.current = { startX: e.clientX, startW: previewW ?? defaultPreviewW() }
                  setDraggingPW(true)
                }}
                onPointerMove={(e) => {
                  const d = pwDrag.current
                  if (!d) return
                  // 预览在分隔条右侧：鼠标右移分隔条右移、预览变窄（与上下分栏的 startH - dy 对称）
                  setPreviewW(clampPreviewW(d.startW - (e.clientX - d.startX)))
                }}
                onPointerUp={() => { pwDrag.current = null; setDraggingPW(false) }}
              />
            )}

            {mode === 'split' && narrow && (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="拖拽调整预览区高度"
                title="拖动调整预览高度（双击复位）"
                tabIndex={0}
                className="-mx-2 my-2 h-2 shrink-0 cursor-row-resize rounded-full transition-colors hover:bg-primary/25 data-[dragging=true]:bg-primary/50"
                data-dragging={draggingPH ? 'true' : undefined}
                onDoubleClick={() => setPreviewH(defaultPreviewH())}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  phDrag.current = { startY: e.clientY, startH: previewH ?? defaultPreviewH() }
                  setDraggingPH(true)
                }}
                onPointerMove={(e) => {
                  const d = phDrag.current
                  if (!d) return
                  setPreviewH(clampPreviewH(d.startH - (e.clientY - d.startY)))
                }}
                onPointerUp={() => { phDrag.current = null; setDraggingPH(false) }}
              />
            )}

            {mode !== 'editor' && (
              <div
                className={`flex flex-col overflow-hidden rounded-xl border bg-muted/30 ${mode === 'split' ? 'shrink-0' : 'min-h-0 flex-1'}`}
                style={mode === 'split'
                  ? (narrow
                      ? { height: `${previewH ?? FALLBACK_PREVIEW_H}px` }
                      : { width: `${previewW ?? FALLBACK_PREVIEW_W}px` })
                  : undefined}
              >
                <p className="border-b bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">实时预览</p>
                <div ref={previewScrollRef} className="min-h-0 flex-1 overflow-auto p-3" onScroll={(e) => syncScroll('preview', e.currentTarget)}>
                  {content.trim()
                    ? <MarkdownText src={content} />
                    : <p className="text-sm text-muted-foreground">
                        {mode === 'preview'
                          ? '暂无内容——切换到编辑模式开始输入'
                          : `${narrow ? '上方' : '左侧'}开始输入，这里实时显示 Markdown 渲染效果（支持表格与公式）`}
                      </p>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center gap-2 border-t px-5 py-3 text-xs text-muted-foreground">
          <span className="hidden md:inline">{mode === 'split' ? '拖动抽屉上缘调高度 · 拖动分隔条调预览宽度' : '拖动抽屉上缘调高度'}</span>
          <span className="md:hidden">{mode === 'split' ? '拖动上缘/分隔条调整' : '拖动上缘调整'}</span>
          <span className="flex-1" />
          {content.trim() && (
            <Button variant="ghost" size="xs" onClick={onDelete}><Trash2 data-icon="inline-start" />删除本句笔记</Button>
          )}
          <Button size="sm" onClick={onClose}>完成</Button>
        </div>

        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="关闭笔记">
          <X className="size-4" aria-hidden />
        </button>

        {/* 上缘高度拖拽柄 */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="拖拽调整抽屉高度"
          title="拖动调整高度（双击复位）"
          tabIndex={0}
          className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize transition-colors hover:bg-primary/40 data-[dragging=true]:bg-primary/60"
          data-dragging={draggingHeight ? 'true' : undefined}
          onDoubleClick={() => setHeight(defaultHeight())}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            edgeDrag.current = { startY: e.clientY, startH: height }
            setDraggingHeight(true)
          }}
          onPointerMove={(e) => {
            const d = edgeDrag.current
            if (!d) return
            setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight(), d.startH - (e.clientY - d.startY))))
            // 抽屉变矮会压缩上下分栏（窄屏）的可用高，同步重夹预览高——否则编辑器被压没
            setPreviewH((h) => (h == null || !narrow ? h : clampPreviewH(h)))
          }}
          onPointerUp={() => { edgeDrag.current = null; setDraggingHeight(false) }}
        />
      </div>
    </div>
  )
}

export { SentenceNoteDrawer }
