/**
 * 播放引擎装配 Hook —— Blob→ObjectURL 生命周期 + HtmlPlayerController/SentencePlayer 装配。
 *
 * 原先 dictation/puzzle/shadowing/read-aloud 四页各持一份逐字拷贝的装配 effect
 * （引擎级修复要改四处、漏一处就漂移），收敛于此。播放器页（player.tsx）的装配
 * 深度页面化（进度恢复/收藏定位/倍速循环偏好/双媒体元素），保留专属实现。
 *
 * 生命周期约定：
 *  - sentences 引用变化（如删句后 record 更新）→ 引擎整体重建；
 *  - audio 材料复用页面常驻的隐藏 <audio> 元素（mediaElement 传入），video 材料内建元素；
 *  - 卸载/重建时统一 destroy 并 revoke ObjectURL。
 */

import { useEffect, useRef, useState } from 'react'
import { SentencePlayer, type SentenceRange } from '@/core/player/sentence-player'
import { HtmlPlayerController } from '@/platform/html-player'
import { getMediaBlob } from '@/stores/material-store'

/** 稳定空时间轴（hook 依赖需要稳定引用，避免每渲染重建引擎）—— dictation/puzzle/shadowing/read-aloud 共用 */
export const NO_SENTENCES: SentenceRange[] = []

/**
 * 媒体 Blob → ObjectURL（SSR 安全：仅 effect 内触碰浏览器 API）。
 * 无媒体 / 加载中返回 null；换材料或卸载时 revoke 旧 URL。
 */
export function useMediaObjectUrl(materialId: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!materialId) return
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      try {
        const blob = await getMediaBlob(materialId)
        if (cancelled) return
        if (blob) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        }
      } catch { /* 无媒体：调用方按不可播放处理 */ }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [materialId])
  return url
}

export interface UseSentencePlayerOptions {
  /** 媒体类型（决定内建 audio/video 元素） */
  mediaType: 'audio' | 'video'
  /** 句子时间轴（引用变化时引擎重建；传入方保证稳定引用，如模块级空数组常量） */
  sentences: SentenceRange[]
  /** audio 材料时复用的页面常驻隐藏 <audio> 元素；video 材料忽略此参数 */
  audioElement?: React.RefObject<HTMLAudioElement | null>
  /** 引擎创建后立即回调（订阅事件等；无需清理，destroy 统一清空 handlers） */
  onSetup?: (player: SentencePlayer, controller: HtmlPlayerController) => void
  /** 媒体 load 成功后回调（如 duration 兜底） */
  onLoaded?: (player: SentencePlayer, controller: HtmlPlayerController) => void
}

export interface UseSentencePlayerResult {
  /** 就绪的 SentencePlayer（媒体未就绪为 null；重建期间短暂为 null） */
  player: SentencePlayer | null
  /** 稳定 ref 镜像；事件回调读取最新实例，不由每个页面在渲染期手写赋值 */
  playerRef: React.RefObject<SentencePlayer | null>
  /** 媒体 ObjectURL（无媒体为 null；页面 <audio src> 直接使用） */
  mediaUrl: string | null
}

export function useSentencePlayer(materialId: string | undefined, options: UseSentencePlayerOptions): UseSentencePlayerResult {
  const { mediaType, sentences, audioElement } = options
  const mediaUrl = useMediaObjectUrl(materialId)
  const [player, setPlayer] = useState<SentencePlayer | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  // 回调走 ref：闭包读最新状态，且回调变化不触发引擎重建
  const onSetupRef = useRef(options.onSetup)
  onSetupRef.current = options.onSetup
  const onLoadedRef = useRef(options.onLoaded)
  onLoadedRef.current = options.onLoaded

  useEffect(() => {
    if (!mediaUrl) {
      setPlayer(null)
      playerRef.current = null
      return
    }
    // audio 材料复用页面元素；video 材料内建（与四页历史行为一致）
    const el = mediaType === 'audio' ? audioElement?.current : undefined
    const controller = el ? new HtmlPlayerController('audio', el) : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, sentences)
    onSetupRef.current?.(sp, controller)
    playerRef.current = sp
    setPlayer(sp)
    controller
      .load({ type: mediaType, src: mediaUrl })
      .then(() => { onLoadedRef.current?.(sp, controller) })
      .catch(() => { /* 加载失败：调用方按不可播放处理 */ })
    return () => {
      sp.destroy()
      controller.destroy()
      playerRef.current = null
      setPlayer(null)
    }
    // eslint 不在仓内；audioElement 为 ref 对象，引用稳定
  }, [mediaUrl, mediaType, sentences, audioElement])

  return { player, playerRef, mediaUrl }
}
