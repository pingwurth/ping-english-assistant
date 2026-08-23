/**
 * 小程序音频播放适配器：InnerAudioContext（架构文档 §2.2）
 * 含 seek 精度补偿（架构文档 §5.1）：
 * - seekTo(target) 后记录目标值；
 * - 下一次 onTimeUpdate 若实际位置与目标偏差 >300ms 且方向一致，
 *   在循环边界判断中以实际落点修正 endMs 容差（±250ms）。
 * 需后台播放时由业务层切换 BackgroundAudioManager（同接口另一实现，后续迭代）。
 */
// #ifdef MP-WEIXIN
import type {
  MediaSource,
  PlayerController,
  PlayerEvents,
  PlayerState
} from '@/core/player/types';
import { PlayerEventEmitter } from '@/core/player/types';

const SEEK_DEVIATION_MS = 300;
const LOOP_TOLERANCE_MS = 250;

export class MpInnerAudioAdapter implements PlayerController {
  private ctx: UniApp.InnerAudioContext | null = null;
  private emitter = new PlayerEventEmitter();
  private state: PlayerState = 'idle';
  private durationMs = 0;
  private loop: { startMs: number; endMs: number } | null = null;
  private pendingSeekMs: number | null = null;
  private seekOffsetMs = 0;

  load(source: MediaSource): Promise<void> {
    this.destroyCtx();
    this.setState('loading');
    return new Promise((resolve, reject) => {
      const ctx = uni.createInnerAudioContext();
      this.ctx = ctx;
      ctx.src = source.src;
      ctx.onCanplay(() => {
        this.setState('ready');
        resolve();
      });
      ctx.onTimeUpdate(() => {
        const actualMs = ctx.currentTime * 1000;
        // seek 精度补偿：实际落点与目标偏差过大时修正循环边界容差
        if (this.pendingSeekMs != null) {
          const deviation = actualMs - this.pendingSeekMs;
          this.seekOffsetMs = Math.abs(deviation) > SEEK_DEVIATION_MS ? deviation : 0;
          this.pendingSeekMs = null;
        }
        if (this.loop) {
          const correctedEnd = this.loop.endMs + this.seekOffsetMs;
          if (actualMs >= correctedEnd - LOOP_TOLERANCE_MS) {
            this.seekTo(this.loop.startMs);
            return;
          }
        }
        this.emitter.emit('timeupdate', actualMs);
      });
      ctx.onPlay(() => this.setState('playing'));
      ctx.onPause(() => this.setState('paused'));
      ctx.onEnded(() => {
        this.setState('ended');
        this.emitter.emit('ended');
      });
      ctx.onError((err) => {
        this.setState('error');
        this.emitter.emit('error', {
          code: 'media-error',
          message: '音频加载失败',
          detail: err
        });
        reject(new Error('音频加载失败'));
      });
    });
  }

  async play(): Promise<void> {
    this.ctx?.play();
  }

  pause(): void {
    this.ctx?.pause();
  }

  seekTo(ms: number): void {
    this.pendingSeekMs = ms;
    this.ctx?.seek(ms / 1000);
  }

  setRate(rate: number): void {
    if (this.ctx) this.ctx.playbackRate = rate;
  }

  setVolume(_volume: number): void {
    // 小程序音频音量跟随系统（架构文档 §2.2 接口注释）
  }

  setLoop(startMs: number, endMs: number): void {
    this.loop = { startMs, endMs };
  }

  clearLoop(): void {
    this.loop = null;
    this.seekOffsetMs = 0;
  }

  getCurrentTimeMs(): number {
    return (this.ctx?.currentTime ?? 0) * 1000;
  }

  getDurationMs(): number {
    return this.durationMs || (this.ctx?.duration ?? 0) * 1000;
  }

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.on(event, cb);
  }

  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.off(event, cb);
  }

  destroy(): void {
    this.destroyCtx();
    this.emitter.clear();
  }

  private destroyCtx(): void {
    this.ctx?.destroy();
    this.ctx = null;
  }

  private setState(s: PlayerState): void {
    if (this.state !== s) {
      this.state = s;
      this.emitter.emit('statechange', s);
    }
  }
}
// #endif
