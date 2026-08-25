/**
 * H5 PlayerController 实现 —— 原生 HTMLAudioElement / HTMLVideoElement
 * 真源：docs/系统架构设计.md §2.2（接口）/ §5.1（seek 落点补偿）
 *
 * 关键机制：
 *  - 进度采样：原生 `timeupdate` 兜底（~4Hz），播放中另起 requestAnimationFrame
 *    循环读取 currentTime（~60Hz），保证进度条与句级定位平滑；
 *  - 倍速：原生 playbackRate（preservesPitch 保留默认）；
 *  - seek 落点校准（§5.1）：seekTo 后记录目标值并静默旧进度，直到首个
 *    原生 timeupdate 到达 —— 以实际落点作为校准后的 currentMs 派发；
 *    偏差 >300ms 时记录 seekDriftMs，供上层修正循环边界容差；
 *  - destroy()：停 rAF、解绑全部监听、卸载 src、清空事件表与引用。
 *
 * SSR 安全：仅在浏览器内由调用方 new（页面 useEffect 中），不在模块顶层触碰 DOM。
 */

import type { MediaSource, PlayerController, PlayerError, PlayerEvents, PlayerState } from '@/core/player/types'

/** seek 后实际落点与目标偏差超过该值视为"漂移"，记录供上层容差修正（架构 §5.1） */
const SEEK_DRIFT_THRESHOLD_MS = 300
/** seek 校准兜底超时：此后仍无原生 timeupdate 则强制解除静默，防进度派发永久卡死 */
const SEEK_CALIBRATE_TIMEOUT_MS = 2000

export class HtmlPlayerController implements PlayerController {
  private el: HTMLAudioElement | HTMLVideoElement
  private ownsElement: boolean
  private handlers: { [E in keyof PlayerEvents]: Set<PlayerEvents[E]> } = {
    timeupdate: new Set(),
    statechange: new Set(),
    ended: new Set(),
    error: new Set(),
  }
  private state: PlayerState = 'idle'
  private currentMs = 0
  private durationMs = 0
  private rafId: number | null = null
  /** 待校准的 seek 目标（null = 无待校准 seek） */
  private pendingSeekMs: number | null = null
  /** 待校准 seek 的兜底超时句柄 */
  private seekTimer: number | null = null
  /** 最近一次 seek 的实际漂移量（实际落点 - 目标） */
  private seekDriftMs = 0
  /** controller 级 A-B 循环区间（无次数限制；带次数的循环由 SentencePlayer 承担） */
  private loop: { startMs: number; endMs: number } | null = null
  private destroyed = false
  private listeners: Array<[string, EventListener]> = []

  /**
   * @param kind 媒体类型（决定内部创建 audio 还是 video 元素）
   * @param element 可选：复用页面已有的隐藏媒体元素；不传则内部创建
   */
  constructor(kind: 'audio' | 'video', element?: HTMLAudioElement | HTMLVideoElement) {
    if (element) {
      this.el = element
      this.ownsElement = false
    } else if (typeof document !== 'undefined') {
      this.el = kind === 'video' ? document.createElement('video') : new Audio()
      this.ownsElement = true
    } else {
      throw new Error('HtmlPlayerController 仅支持浏览器环境')
    }
    this.bind()
  }

  // ── PlayerController 接口 ────────────────────────────────
  load(source: MediaSource): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) return reject(new Error('destroyed'))
      this.setState('loading')
      const onReady = () => { cleanup(); this.setState('ready'); resolve() }
      const onErr = () => { cleanup(); this.setState('error'); this.emitError('LOAD_FAILED', '媒体加载失败') ; reject(new Error('load failed')) }
      const cleanup = () => {
        this.el.removeEventListener('loadedmetadata', onReady)
        this.el.removeEventListener('canplay', onReady)
        this.el.removeEventListener('error', onErr)
      }
      this.el.addEventListener('loadedmetadata', onReady)
      this.el.addEventListener('canplay', onReady)
      this.el.addEventListener('error', onErr)
      this.el.src = source.src
      this.el.load()
    })
  }

  play(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('destroyed'))
    const p = this.el.play()
    return p ? p.catch((e: unknown) => { this.emitError('PLAY_BLOCKED', e instanceof Error ? e.message : '播放被拦截'); throw e }) : Promise.resolve()
  }

  pause(): void {
    if (!this.destroyed) this.el.pause()
  }

  seekTo(ms: number): void {
    if (this.destroyed) return
    const target = Math.max(0, Number.isFinite(ms) ? ms : 0)
    try {
      this.el.currentTime = target / 1000
    } catch {
      return // 元素未就绪（无 src/未加载元数据）：不进入待校准态，避免进度静默
    }
    this.pendingSeekMs = target
    this.armSeekTimeout()
  }

  setRate(rate: number): void {
    if (!this.destroyed && Number.isFinite(rate)) this.el.playbackRate = Math.min(2, Math.max(0.5, rate))
  }

  setVolume(volume: number): void {
    if (!this.destroyed && Number.isFinite(volume)) this.el.volume = Math.min(1, Math.max(0, volume))
  }

  setLoop(startMs: number, endMs: number): void {
    this.loop = endMs > startMs ? { startMs, endMs } : null
  }

  clearLoop(): void {
    this.loop = null
  }

  getCurrentTimeMs(): number { return this.currentMs }
  getDurationMs(): number { return this.durationMs || this.readDurationMs() }
  getState(): PlayerState { return this.state }
  /** 最近一次 seek 漂移量（ms），供上层循环容差修正（架构 §5.1） */
  getSeekDriftMs(): number { return this.seekDriftMs }
  /** 是否正处于待校准 seek 中（UI 可据此冻结进度显示） */
  isSeeking(): boolean { return this.pendingSeekMs !== null }

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void { this.handlers[event].add(cb) }
  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void { this.handlers[event].delete(cb) }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopRaf()
    this.clearSeekTimeout()
    for (const [name, fn] of this.listeners) this.el.removeEventListener(name, fn)
    this.listeners = []
    try {
      this.el.pause()
      this.el.removeAttribute('src')
      this.el.load()
    } catch { /* ignore */ }
    for (const key of Object.keys(this.handlers) as (keyof PlayerEvents)[]) this.handlers[key].clear()
  }

  // ── 内部实现 ──────────────────────────────────────────────
  private bind(): void {
    const listen = (name: string, fn: EventListener) => {
      this.el.addEventListener(name, fn)
      this.listeners.push([name, fn])
    }
    listen('timeupdate', () => this.onNativeTimeUpdate())
    listen('loadedmetadata', () => { this.durationMs = this.readDurationMs() })
    listen('durationchange', () => { this.durationMs = this.readDurationMs() })
    listen('play', () => { this.setState('playing'); this.startRaf() })
    listen('pause', () => { this.stopRaf(); if (this.state !== 'ended' && this.state !== 'error') this.setState('paused') })
    listen('ended', () => { this.stopRaf(); this.setState('ended'); this.emit('ended') })
    listen('waiting', () => { if (this.state === 'playing') this.setState('loading') })
    listen('playing', () => this.setState('playing'))
    listen('error', () => {
      this.setState('error')
      const code = this.el.error ? String(this.el.error.code) : 'UNKNOWN'
      this.emitError(`MEDIA_ERROR_${code}`, this.el.error?.message ?? '媒体错误')
    })
  }

  /** 原生 timeupdate：兜底采样 + seek 落点校准（§5.1） */
  private onNativeTimeUpdate(): void {
    const actualMs = this.readCurrentMs()
    if (this.pendingSeekMs !== null) {
      // 首个 timeupdate = 实际落点：记录漂移并以此校准 currentMs
      this.seekDriftMs = actualMs - this.pendingSeekMs
      if (Math.abs(this.seekDriftMs) <= SEEK_DRIFT_THRESHOLD_MS) this.seekDriftMs = 0
      this.pendingSeekMs = null
      this.clearSeekTimeout()
      this.currentMs = actualMs
      this.emit('timeupdate', actualMs)
      return
    }
    this.pushTime(actualMs)
  }

  /** 读当前播放位置（ms）；NaN/非法值回退 0 */
  private readCurrentMs(): number {
    const ms = Math.round(this.el.currentTime * 1000)
    return Number.isFinite(ms) ? ms : 0
  }

  /** 读媒体总时长（ms）；NaN/Infinity（未就绪或直播流）回退 0 */
  private readDurationMs(): number {
    const ms = Math.round(this.el.duration * 1000)
    return Number.isFinite(ms) && ms > 0 ? ms : 0
  }

  /** seek 校准兜底：超时仍无 timeupdate 则强制解除静默并按实际位置派发 */
  private armSeekTimeout(): void {
    this.clearSeekTimeout()
    if (typeof window === 'undefined') return
    this.seekTimer = window.setTimeout(() => {
      this.seekTimer = null
      if (this.destroyed || this.pendingSeekMs === null) return
      this.pendingSeekMs = null
      this.pushTime(this.readCurrentMs())
    }, SEEK_CALIBRATE_TIMEOUT_MS)
  }

  private clearSeekTimeout(): void {
    if (this.seekTimer !== null && typeof window !== 'undefined') window.clearTimeout(this.seekTimer)
    this.seekTimer = null
  }

  /** 播放中 rAF 高频采样（timeupdate 仅 ~4Hz，进度条需要更平滑） */
  private startRaf(): void {
    if (this.rafId !== null || typeof requestAnimationFrame === 'undefined') return
    const tick = () => {
      this.rafId = null
      if (this.destroyed) return
      if (!this.el.paused && !this.el.ended) {
        this.pushTime(this.readCurrentMs())
        this.rafId = requestAnimationFrame(tick)
      }
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopRaf(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  /** 派发进度：seek 待校准期间静默旧值，防止进度条回跳闪烁 */
  private pushTime(ms: number): void {
    if (this.pendingSeekMs !== null) return
    this.currentMs = ms
    if (this.loop && ms >= this.loop.endMs) {
      this.seekTo(this.loop.startMs)
      return
    }
    this.emit('timeupdate', ms)
  }

  private setState(state: PlayerState): void {
    if (this.state === state) return
    this.state = state
    this.emit('statechange', state)
  }

  private emit<E extends keyof PlayerEvents>(event: E, ...args: Parameters<PlayerEvents[E]>): void {
    for (const cb of this.handlers[event]) (cb as (...a: unknown[]) => void)(...args)
  }

  private emitError(code: string, message: string): void {
    this.emit('error', { code, message })
  }
}

/** 工厂：按媒体类型创建 H5 控制器（架构 §2.2 createPlayer 的 H5 分支） */
export function createHtmlPlayer(kind: 'audio' | 'video', element?: HTMLAudioElement | HTMLVideoElement): HtmlPlayerController {
  return new HtmlPlayerController(kind, element)
}
