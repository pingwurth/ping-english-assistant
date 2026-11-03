import { useEffect, useState, useRef } from 'react'

interface BackgroundCarouselProps {
  /** 图片路径数组 */
  images: string[]
  /** 切换间隔（毫秒），默认 8000 */
  interval?: number
  /** 过渡时间（毫秒），默认 1000 */
  transitionDuration?: number
  /** 额外的 CSS 类名 */
  className?: string
}

/**
 * 背景图片轮播组件：自动循环、淡入淡出。
 * 只挂载「当前 + 下一张（预载）+ 过渡中的旧图」：全量 26 张 ~1.2MB PNG 常驻会占用
 * ~112MB 解码位图与 26 个合成层，且首屏 26 路并发请求挤占媒体/字幕加载
 * （2026-11 全仓复审）。
 */
export function BackgroundCarousel({
  images,
  interval = 8000,
  transitionDuration = 1000,
  className = '',
}: BackgroundCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  /** 过渡中的旧图 index；淡出完成后置回 null 卸载 */
  const [fadeFrom, setFadeFrom] = useState<number | null>(null)
  /** 已解码完成的图片 index（当前图就绪才淡入，替代原全局 isLoaded 门控） */
  const [loadedSet, setLoadedSet] = useState<ReadonlySet<number>>(new Set())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastIndexRef = useRef(0)

  // currentIndex 变化：保留旧图参与淡出，过渡结束（含余量）后卸载
  useEffect(() => {
    const outgoing = lastIndexRef.current
    lastIndexRef.current = currentIndex
    if (outgoing === currentIndex) return
    setFadeFrom(outgoing)
    const t = setTimeout(() => setFadeFrom(null), transitionDuration + 200)
    return () => clearTimeout(t)
  }, [currentIndex, transitionDuration])

  // 自动轮播定时器（单张不启动）
  useEffect(() => {
    if (images.length <= 1) return
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length)
    }, interval)
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [images.length, interval])

  const markLoaded = (index: number) => {
    setLoadedSet((prev) => (prev.has(index) ? prev : new Set(prev).add(index)))
  }

  // 空数组时显示默认背景
  if (images.length === 0) {
    return <div className={`bg-primary ${className}`} />
  }

  // 单张图片直接显示
  if (images.length === 1) {
    return (
      <div className={className}>
        <img
          src={images[0]}
          className="h-full w-full object-cover"
          alt=""
          draggable={false}
        />
      </div>
    )
  }

  // 只挂载当前、下一张（预载，保证切换瞬间即可淡入）与过渡中的旧图
  const nextIndex = (currentIndex + 1) % images.length
  const visible = new Set([currentIndex, nextIndex])
  if (fadeFrom != null) visible.add(fadeFrom)

  return (
    <div className={className}>
      {images.map((src, index) =>
        visible.has(index) ? (
          <img
            key={src}
            src={src}
            className="absolute inset-0 h-full w-full object-cover transition-opacity"
            style={{
              transitionDuration: `${transitionDuration}ms`,
              opacity: index === currentIndex && loadedSet.has(index) ? 1 : 0,
            }}
            onLoad={() => markLoaded(index)}
            onError={() => markLoaded(index)}
            alt=""
            draggable={false}
          />
        ) : null,
      )}
    </div>
  )
}
