/**
 * H5 音频播放适配器：Howler.js（架构文档 §2.2）
 * A-B 循环用 sprite 定义 [startMs, durMs, loop]，天然支持单句循环。
 */
// #ifdef H5
import { Howl } from 'howler';
import type {
  MediaSource,
  PlayerController,
  PlayerError,
  PlayerEvents,
  PlayerState
} from '@/core/player/types';
import { PlayerEventEmitter } from '@/core/player/types';

export class HowlerAdapter implements PlayerController {
  private howl: Howl | null = null;
  private emitter = new PlayerEventEmitter();
  private state: PlayerState = 'idle';
  private rate = 1;
  private volume = 1;
  private loop: { startMs: number; endMs: number } | null = null;
  private seekTargetMs: number | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  load(source: MediaSource): Promise<void> {
    this.setState('loading');
    return new Promise((resolve, reject) => {
      this.howl?.unload();
      this.howl = new Howl({
        src: [source.src],
        html5: true,
        rate: this.rate,
        volume: this.volume,
        onload: () => {
          this.setState('ready');
          resolve();
        },
        onloaderror: (_id, err) => {
          this.setState('error');
          const e: PlayerError = { code: 'load-error', message: '音频加载失败', detail: err };
          this.emitter.emit('error', e);
          reject(e);
        },
        onend: () => {
          this.setState('ended');
          this.emitter.emit('ended');
        },
        onplay: () => {
          this.setState('playing');
          this.startTicker();
        },
        onpause: () => {
          this.setState('paused');
          this.stopTicker();
        },
        onstop: () => this.stopTicker()
      });
    });
  }

  async play(): Promise<void> {
    if (this.seekTargetMs != null && this.howl) {
      this.howl.seek(this.seekTargetMs / 1000);
      this.seekTargetMs = null;
    }
    this.howl?.play();
  }

  pause(): void {
    this.howl?.pause();
  }

  seekTo(ms: number): void {
    if (!this.howl) return;
    if (this.howl.playing()) {
      this.howl.seek(ms / 1000);
    } else {
      this.seekTargetMs = ms;
      this.howl.seek(ms / 1000);
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.howl?.rate(rate);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.howl?.volume(volume);
  }

  setLoop(startMs: number, endMs: number): void {
    this.loop = { startMs, endMs };
  }

  clearLoop(): void {
    this.loop = null;
  }

  getCurrentTimeMs(): number {
    return (this.howl?.seek() ?? 0) * 1000;
  }

  getDurationMs(): number {
    return (this.howl?.duration() ?? 0) * 1000;
  }

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.on(event, cb);
  }

  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.off(event, cb);
  }

  destroy(): void {
    this.stopTicker();
    this.howl?.unload();
    this.howl = null;
    this.emitter.clear();
  }

  /** Howler 无原生 timeupdate 事件，用 250ms 轮询驱动（含 A-B 循环判断） */
  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval(() => {
      if (!this.howl || !this.howl.playing()) return;
      const ms = this.getCurrentTimeMs();
      if (this.loop && ms >= this.loop.endMs - 250) {
        this.howl.seek(this.loop.startMs / 1000);
        return;
      }
      this.emitter.emit('timeupdate', ms);
    }, 250);
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private setState(s: PlayerState): void {
    if (this.state !== s) {
      this.state = s;
      this.emitter.emit('statechange', s);
    }
  }
}
// #endif
