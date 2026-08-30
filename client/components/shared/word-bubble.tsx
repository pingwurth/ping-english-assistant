/**
 * 选词浮动气泡 —— 用户在指定区域内选中英文文本后浮现
 *
 * 方案 A 实现：
 * - 监听 document `selectionchange` 事件
 * - 通过 selectionContainerRef 判断选区是否在目标区域内
 * - 遍历 items[] 做全句匹配（不绑定当前激活句）
 * - Portal 渲染到 body，fixed 定位
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookPlus, Check } from 'lucide-react'
import { hasText, initVocab } from '@/stores/vocab-store'
import { useStore } from '@/stores/store'
import { vocabStore } from '@/stores/vocab-store'
import { VocabBookPicker } from './vocab-book-picker'
import type { SubtitleSentence } from '@/types/subtitle'

interface WordBubbleProps {
  /** 所有字幕句子（用于全句匹配） */
  items: SubtitleSentence[]
  /** 来源素材 ID */
  materialId: string
  /** 选区监听的目标容器 ref（选区需在此容器内才触发气泡） */
  selectionContainerRef: React.RefObject<HTMLElement | null>
}

interface BubbleState {
  text: string
  sentence: SubtitleSentence
  x: number
  y: number
}

/** 标准化文本：trim + 合并空白 + 统一引号 */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[‘’“”]/g, (c) => (c === '‘' || c === '’' ? "'" : '"'))
}

export function WordBubble({ items, materialId, selectionContainerRef }: WordBubbleProps) {
  const [bubble, setBubble] = useState<BubbleState | null>(null)
  const [addedBookName, setAddedBookName] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef(0)

  useStore(vocabStore)

  useEffect(() => {
    initVocab().then(() => setInitialized(true))
  }, [])

  const isAlreadyAdded = bubble ? hasText(bubble.text) : false

  const clearBubble = useCallback(() => {
    setBubble(null)
    setAddedBookName(null)
  }, [])

  // 核心：处理选区变化
  const processSelection = useCallback(() => {
    rafRef.current = 0

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return

    const selectedText = sel.toString()
    const normalized = normalize(selectedText)
    if (normalized.length < 1) return

    // 检查选区是否在目标容器内
    const container = selectionContainerRef.current
    if (!container) return
    const anchorNode = sel.anchorNode
    if (!anchorNode || !container.contains(anchorNode)) return

    // 遍历所有句子，找 textEn 包含选中文本的那个
    let matched: SubtitleSentence | null = null
    for (const s of items) {
      if (normalize(s.textEn).includes(normalized)) {
        matched = s
        break
      }
    }
    if (!matched) return

    // 计算气泡位置
    const range = sel.getRangeAt(0)
    const rect = range.getBoundingClientRect()

    setBubble({
      text: normalized,
      sentence: matched,
      x: rect.left,
      y: rect.top - 8,
    })
    setAddedBookName(null)
  }, [items, selectionContainerRef])

  // 监听 selectionchange — rAF 节流
  useEffect(() => {
    const onSelectionChange = () => {
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(processSelection)
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [processSelection])

  // 点击外部关闭气泡
  useEffect(() => {
    if (!bubble) return

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (bubbleRef.current?.contains(target)) return
      if ((target as HTMLElement)?.closest?.('[data-dialog]')) return
      clearBubble()
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clearBubble()
        window.getSelection()?.removeAllRanges()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [bubble, clearBubble])

  if (!bubble || !initialized) return null

  const bubbleStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.max(8, bubble.x),
    top: Math.max(8, bubble.y),
    transform: 'translateY(-100%)',
    zIndex: 9999,
  }

  const handleAdded = (bookName: string) => {
    setShowPicker(false)
    setAddedBookName(bookName)
    setTimeout(() => clearBubble(), 2000)
  }

  const bubbleContent = (
    <>
      <div ref={bubbleRef} style={bubbleStyle}>
        <div className="rounded-lg border bg-popover p-3 shadow-lg">
          <div className="mb-2 font-serif text-base font-semibold">{bubble.text}</div>
          {addedBookName ? (
            <div className="flex items-center gap-1.5 text-sm text-primary">
              <Check className="size-4" />
              已添加到「{addedBookName}」
            </div>
          ) : isAlreadyAdded ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Check className="size-4" />
              已收录
            </div>
          ) : (
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
              onClick={() => setShowPicker(true)}
            >
              <BookPlus className="size-4" />
              添加到生词本
            </button>
          )}
        </div>
        <div className="absolute left-6 top-full size-2.5 rotate-45 border-b border-r bg-popover" />
      </div>

      {showPicker && (
        <VocabBookPicker
          selectedText={bubble.text}
          sentenceTextEn={bubble.sentence.textEn}
          sentenceIndex={bubble.sentence.index}
          materialId={materialId}
          onClose={() => setShowPicker(false)}
          onAdded={handleAdded}
        />
      )}
    </>
  )

  return createPortal(bubbleContent, document.body)
}
