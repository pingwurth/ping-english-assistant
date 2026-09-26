/**
 * 滚动渐隐容器 —— 内容溢出时，被截断的一侧渐隐提示「还有内容」：
 * 未滚到顶 → 顶部渐隐；未滚到底 → 底部渐隐；滚到尽头对应一侧即撤掉。
 *
 * 为什么用 JS 判定 + CSS mask，而不是纯 CSS：
 *  - 纯 CSS 无法感知「是否溢出」，无条件挂 mask 会把不溢出的首尾行也淡掉；
 *  - 用 mask 而非叠加同色渐变层：渐隐的是文字本身，不依赖容器背景色
 *    （播放区浮层是半透明毛玻璃，叠加渐变层无法与背景对齐）。
 *
 * 判定时机：ResizeObserver 观察内容高度（切句 / 切换模式 / 窗口缩放都会变），
 * scroll 事件观察滚动位置。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface ScrollFadeProps {
  /** 滚动区布局类（高度上限、min-w-0 等）；根节点即滚动容器 */
  className?: string
  /** 渐隐高度（px）：首尾各多长区间淡出 */
  fadePx?: number
  /** 变化即把滚动位置复位到顶部（如当前句 index），避免新句子沿用上一句的偏移 */
  resetKey?: unknown
  children: React.ReactNode
}

interface FadeState {
  top: boolean
  bottom: boolean
}

/** 按需拼接 mask：单侧渐隐时另一侧保持不透明，避免多余渐变段 */
function buildMask({ top, bottom }: FadeState, fadePx: number): string | undefined {
  if (!top && !bottom) return undefined
  const start = top ? `transparent 0, #000 ${fadePx}px` : '#000 0'
  const end = bottom ? `#000 calc(100% - ${fadePx}px), transparent 100%` : '#000 100%'
  return `linear-gradient(to bottom, ${start}, ${end})`
}

export function ScrollFade({ className, fadePx = 28, resetKey, children }: ScrollFadeProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [fade, setFade] = useState<FadeState>({ top: false, bottom: false })

  const measure = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    // ±1 容差：浏览器亚像素取整会让 scrollHeight 与 clientHeight 相差 1px
    const overflowing = el.scrollHeight > el.clientHeight + 1
    const next: FadeState = {
      top: overflowing && el.scrollTop > 1,
      bottom: overflowing && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    }
    // 滚动中每帧都会调用；值未变时返回原对象，避免无谓重渲染
    setFade((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next))
  }, [])

  useEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(content) // 内容高度变化（换句、模式切换、字号/窗口变化）
    ro.observe(scroller) // 容器自身尺寸变化（max-h 生效、布局让位）
    return () => ro.disconnect()
  }, [measure])

  useEffect(() => { scrollerRef.current?.scrollTo({ top: 0 }) }, [resetKey])

  const mask = buildMask(fade, fadePx)

  return (
    <div
      ref={scrollerRef}
      onScroll={measure}
      className={cn('overflow-y-auto', className)}
      // WebkitMaskImage：Safari 15.4 以下只认带前缀的属性
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  )
}