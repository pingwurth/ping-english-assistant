/**
 * 播放器抽象层类型 —— 真源：docs/系统架构设计.md §2.2 PlayerController 接口
 *
 * core/ 层纯 TypeScript：不依赖任何框架与浏览器全局（类型引用 DOM lib 仅限 platform 实现）。
 */

/** 媒体来源 */
export interface MediaSource {
  type: 'video' | 'audio'
  /** H5 为 ObjectURL/远程 URL；小程序为本地临时文件路径 */
  src: string
}

/** 播放器状态机 */
export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

/** 播放错误 */
export interface PlayerError {
  code: string
  message: string
}

/** 播放事件集（各端原生频率：H5 timeupdate ~4Hz，rAF 补偿至 ~60Hz） */
export interface PlayerEvents {
  /** 播放进度（毫秒） */
  timeupdate: (currentMs: number) => void
  statechange: (state: PlayerState) => void
  ended: () => void
  error: (err: PlayerError) => void
}

/**
 * 平台无关播放器控制器。
 * H5 由 platform/html-player.ts 的 HTMLAudioElement/HTMLVideoElement 实现。
 */
export interface PlayerController {
  load(source: MediaSource): Promise<void>
  play(): Promise<void>
  pause(): void
  /** seek 到毫秒位置；实现内部做落点精度补偿（见架构 §5.1） */
  seekTo(ms: number): void
  /** 倍速 0.5 ~ 2.0 */
  setRate(rate: number): void
  /** 音量 0 ~ 1 */
  setVolume(volume: number): void
  /** 开启 A-B 循环（无次数限制），循环区间 [startMs, endMs] */
  setLoop(startMs: number, endMs: number): void
  clearLoop(): void
  getCurrentTimeMs(): number
  getDurationMs(): number
  getState(): PlayerState
  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void
  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void
  destroy(): void
}
