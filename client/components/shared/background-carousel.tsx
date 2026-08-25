import { useEffect, useState, useRef, useCallback } from 'react'

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
 * 背景图片轮播组件
 * 自动循环显示图片数组，使用淡入淡出过渡效果
 * 图片预加载确保流畅切换
 */
export function BackgroundCarousel({
  images,
  interval = 8000,
  transitionDuration = 1000,
  className = '',
}: BackgroundCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadedImagesRef = useRef<Set<number>>(new Set())

  // 预加载图片
  useEffect(() => {
    if (images.length === 0) return

    const preloadImage = (index: number) => {
      if (loadedImagesRef.current.has(index)) return

      const img = new Image()
      img.src = images[index]
      img.onload = () => {
        loadedImagesRef.current.add(index)
        // 首张图片加载完成后显示
        if (index === 0) {
          setIsLoaded(true)
        }
      }
      img.onerror = () => {
        // 加载失败也标记为已尝试，避免重复加载
        loadedImagesRef.current.add(index)
        if (index === 0) {
          setIsLoaded(true)
        }
      }
    }

    // 预加载所有图片
    images.forEach((_, index) => preloadImage(index))
  }, [images])

  // 自动轮播定时器
  useEffect(() => {
    // 单张图片不启动定时器
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

  return (
    <div className={className}>
      {images.map((src, index) => (
        <img
          key={src}
          src={src}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
            isLoaded ? '' : 'opacity-0'
          }`}
          style={{
            transitionDuration: `${transitionDuration}ms`,
            opacity: index === currentIndex && isLoaded ? 1 : 0,
            willChange: 'opacity',
          }}
          alt=""
          draggable={false}
        />
      ))}
    </div>
  )
}
