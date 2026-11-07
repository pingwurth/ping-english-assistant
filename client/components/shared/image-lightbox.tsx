/**
 * 图片查看器（灯箱）—— 笔记图片点击放大后的全屏查看面（portal 到 body，浮于抽屉之上）。
 *
 * 缩放/平移全走 Pointer Events 单轨（鼠标拖拽与触屏单指共用；双指捏合按 pointers
 * Map 的两点几何计算），wheel 用原生非被动监听（要 preventDefault 阻断背景滚动）。
 * 锚点缩放公式：光标/捏合中心下的图像点在缩放前后保持不动——
 *   q = (anchor − center − offset) / s0，offset′ = anchor − center − q·s1。
 * 平移夹紧：某轴缩放后不超视口 → 该轴回中；超出则限制在 ±(尺寸−视口)/2，图永不脱手。
 * 双击在 适应 ↔ 3×适应 间切换；底部按钮/键盘（+ − 0）以视口中心为锚；
 * Esc 关闭且不冒泡（否则连笔记抽屉一起被关掉）。
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut } from 'lucide-react'

const MIN_SCALE = 0.2
const MAX_SCALE = 8
/** 双击放大倍数（相对「适应屏幕」的倍率） */
const DBL_SCALE = 3

interface View { scale: number; x: number; y: number }

export function ImageLightbox({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  /** view 的即时镜像：wheel/pointer 是原生高频回调，不等 React 状态回合 */
  const viewRef = useRef(view)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pan = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number; mid: { x: number; y: number }; x: number; y: number } | null>(null)

  /** 适应屏幕的基准缩放（图片小于视口时为 1，即原尺寸） */
  const fitScale = useCallback(() => {
    if (!natural) return 1
    return Math.min(window.innerWidth / natural.w, window.innerHeight / natural.h, 1)
  }, [natural])

  /** 应用新视图并夹紧平移 */
  const applyView = useCallback((next: View): void => {
    const clamped = { ...next }
    if (natural) {
      const maxX = Math.max(0, (natural.w * next.scale - window.innerWidth) / 2)
      const maxY = Math.max(0, (natural.h * next.scale - window.innerHeight) / 2)
      clamped.x = Math.max(-maxX, Math.min(maxX, next.x))
      clamped.y = Math.max(-maxY, Math.min(maxY, next.y))
    }
    viewRef.current = clamped
    setView(clamped)
  }, [natural])

  /** 锚点缩放：anchor（视口坐标）下的图像点缩放前后保持不动 */
  const zoomAt = useCallback((nextScale: number, ax: number, ay: number): void => {
    const v = viewRef.current
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    applyView({
      scale: s,
      x: ax - cx - ((ax - cx - v.x) / v.scale) * s,
      y: ay - cy - ((ay - cy - v.y) / v.scale) * s,
    })
  }, [applyView])

  const resetFit = useCallback(() => {
    applyView({ scale: fitScale(), x: 0, y: 0 })
  }, [applyView, fitScale])

  /** 视口中心锚点（按钮/键盘用） */
  const centerZoom = (factor: number) => zoomAt(viewRef.current.scale * factor, window.innerWidth / 2, window.innerHeight / 2)

  // 打开即聚焦：键盘事件落在本组件内（Esc stopPropagation，不连带关抽屉）
  useEffect(() => { rootRef.current?.focus() }, [])

  // wheel 原生非被动监听：React 合成 wheel 可能被标 passive，preventDefault 无效
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(viewRef.current.scale * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      pan.current = { px: e.clientX, py: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y }
    } else if (pointers.current.size === 2) {
      pan.current = null
      const [a, b] = [...pointers.current.values()]
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: viewRef.current.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        x: viewRef.current.x,
        y: viewRef.current.y,
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size >= 2) {
      // 捏合 = 以双指中心为锚的缩放 + 双指平移（q 点公式一并覆盖两者）
      const [a, b] = [...pointers.current.values()]
      const p = pinch.current
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, p.scale * (Math.hypot(a.x - b.x, a.y - b.y) / (p.dist || 1))))
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const qx = (p.mid.x - cx - p.x) / p.scale
      const qy = (p.mid.y - cy - p.y) / p.scale
      applyView({ scale: s, x: mid.x - cx - qx * s, y: mid.y - cy - qy * s })
    } else if (pan.current) {
      const p = pan.current
      applyView({ scale: viewRef.current.scale, x: p.ox + e.clientX - p.px, y: p.oy + e.clientY - p.py })
    }
  }

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    // 双指抬起一指后回到单指平移：以剩余指重启基准，避免视图跳变
    if (pointers.current.size === 1) {
      const rest = [...pointers.current.values()][0]!
      pan.current = { px: rest.x, py: rest.y, ox: viewRef.current.x, oy: viewRef.current.y }
    } else if (pointers.current.size === 0) {
      pan.current = null
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key === '+' || e.key === '=') { e.stopPropagation(); centerZoom(1.25) }
    else if (e.key === '-' || e.key === '_') { e.stopPropagation(); centerZoom(1 / 1.25) }
    else if (e.key === '0') { e.stopPropagation(); resetFit() }
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      tabIndex={-1}
      className="fixed inset-0 z-[70] touch-none select-none bg-black/85 outline-none backdrop-blur-sm"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onDoubleClick={(e) => {
        const fit = fitScale()
        zoomAt(viewRef.current.scale <= fit * 1.05 ? fit * DBL_SCALE : fit, e.clientX, e.clientY)
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          // 就地算 fit（setNatural 是异步状态，闭包里的 natural 还是旧值）
          const el = e.currentTarget
          const n = { w: el.naturalWidth, h: el.naturalHeight }
          setNatural(n)
          const fit = Math.min(window.innerWidth / n.w, window.innerHeight / n.h, 1)
          const v = { scale: fit, x: 0, y: 0 }
          viewRef.current = v
          setView(v)
        }}
        className={`absolute left-1/2 top-1/2 max-h-none max-w-none will-change-transform ${natural ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      />

      {/* 右上关闭 */}
      <button
        type="button"
        aria-label="关闭查看器"
        title="关闭（Esc）"
        onClick={onClose}
        className="absolute right-3 top-3 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="size-5" aria-hidden />
      </button>

      {/* 底部：说明 + 缩放控制（拦截指针，不落到底层平移/关闭） */}
      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4" onPointerDown={(e) => e.stopPropagation()}>
        {alt ? <p className="max-w-[80vw] truncate text-xs text-white/60">{alt}</p> : null}
        <div className="flex items-center gap-0.5 rounded-full bg-black/60 p-1 text-white backdrop-blur">
          <button type="button" aria-label="缩小" title="缩小（− 键）" onClick={() => centerZoom(1 / 1.25)} className="rounded-full p-2 transition-colors hover:bg-white/20"><ZoomOut className="size-4" aria-hidden /></button>
          <button type="button" title="适应屏幕（0 键）" onClick={resetFit} className="min-w-14 rounded-full px-1 py-2 text-center text-xs tabular-nums transition-colors hover:bg-white/20">{Math.round(view.scale * 100)}%</button>
          <button type="button" aria-label="放大" title="放大（+ 键）" onClick={() => centerZoom(1.25)} className="rounded-full p-2 transition-colors hover:bg-white/20"><ZoomIn className="size-4" aria-hidden /></button>
          <button type="button" title="原始大小" onClick={() => zoomAt(1, window.innerWidth / 2, window.innerHeight / 2)} className="rounded-full px-2.5 py-2 text-xs transition-colors hover:bg-white/20">1:1</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
