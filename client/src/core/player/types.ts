/**
 * PlayerController 抽象层接口（架构文档 §2.2 · ADR-1）
 * 上层业务零分支；三端实现在 platform/player/ 中按条件编译选择。
 */

/** 媒体来源 */
export interface MediaSource {
  type: 'video' | 'audio';
  /** H5 为 ObjectURL/远程 URL；小程序为本地临时文件路径 */
  src: string;
}

export type PlayerState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlayerError {
  code: string;
  message: string;
  detail?: unknown;
}

export interface PlayerEvents {
  /** 播放进度（各端原生频率：H5 ~4-60Hz，小程序 ~100-250ms） */
  timeupdate: (currentMs: number) => void;
  statechange: (state: PlayerState) => void;
  ended: () => void;
  error: (err: PlayerError) => void;
}

export interface PlayerController {
  load(source: MediaSource): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  /** seek 到毫秒位置；小程序实现内部做精度补偿（见架构文档 §5.1） */
  seekTo(ms: number): void;
  /** 倍速 0.5 ~ 2.0 */
  setRate(rate: number): void;
  /** 音量 0 ~ 1，小程序音频忽略 */
  setVolume(volume: number): void;
  /** 开启 A-B 循环（单句循环），循环区间 [startMs, endMs] */
  setLoop(startMs: number, endMs: number): void;
  clearLoop(): void;
  getCurrentTimeMs(): number;
  getDurationMs(): number;
  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void;
  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void;
  destroy(): void;
}

/** 通用事件发射器：供三端适配器复用 */
export class PlayerEventEmitter {
  private listeners = new Map<keyof PlayerEvents, Set<(...args: never[]) => void>>();

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as (...args: never[]) => void);
  }

  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.listeners.get(event)?.delete(cb as (...args: never[]) => void);
  }

  emit<E extends keyof PlayerEvents>(event: E, ...args: Parameters<PlayerEvents[E]>): void {
    this.listeners.get(event)?.forEach((cb) => {
      (cb as (...a: unknown[]) => void)(...args);
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
