/**
 * H5 视频播放适配器：ArtPlayer（架构文档 §2.2）
 * 仅 H5 端编译（条件编译 import）。
 */
// #ifdef H5
import Artplayer from 'artplayer';
import type {
  MediaSource,
  PlayerController,
  PlayerError,
  PlayerEvents,
  PlayerState
} from '@/core/player/types';
import { PlayerEventEmitter } from '@/core/player/types';

export class ArtPlayerAdapter implements PlayerController {
  private art: Artplayer | null = null;
  private emitter = new PlayerEventEmitter();
  private state: PlayerState = 'idle';
  private loop: { startMs: number; endMs: number } | null = null;
  private container: HTMLElement | null = null;

  /** 绑定页面容器元素（页面 mounted 后调用） */
  mount(el: HTMLElement): void {
    this.container = el;
    if (this.pendingSrc) {
      void this.load(this.pendingSrc);
      this.pendingSrc = null;
    }
  }

  private pendingSrc: MediaSource | null = null;

  load(source: MediaSource): Promise<void> {
    if (!this.container) {
      this.pendingSrc = source;
      return Promise.resolve();
    }
    this.setState('loading');
    return new Promise((resolve, reject) => {
      this.art?.destroy();
      this.art = new Artplayer({
        container: this.container as HTMLDivElement,
        url: source.src,
        playbackRate: true,
        setting: false,
        loop: false,
        muted: false,
        autoplay: false,
        pip: false,
        fullscreen: true,
        fullscreenWeb: true
      });
      this.art.on('ready', () => {
        this.setState('ready');
        resolve();
      });
      this.art.on('video:timeupdate', () => {
        const ms = (this.art?.currentTime ?? 0) * 1000;
        if (this.loop && ms >= this.loop.endMs - 250) {
          this.art!.currentTime = this.loop.startMs / 1000;
          return;
        }
        this.emitter.emit('timeupdate', ms);
      });
      this.art.on('play', () => this.setState('playing'));
      this.art.on('pause', () => this.setState('paused'));
      this.art.on('video:ended', () => {
        this.setState('ended');
        this.emitter.emit('ended');
      });
      this.art.on('error', (err) => {
        this.setState('error');
        const e: PlayerError = { code: 'media-error', message: '媒体加载失败', detail: err };
        this.emitter.emit('error', e);
        reject(e);
      });
    });
  }

  async play(): Promise<void> {
    await this.art?.play();
  }

  pause(): void {
    this.art?.pause();
  }

  seekTo(ms: number): void {
    if (this.art) this.art.currentTime = ms / 1000;
  }

  setRate(rate: number): void {
    if (this.art) this.art.playbackRate = rate;
  }

  setVolume(volume: number): void {
    if (this.art) this.art.volume = volume;
  }

  setLoop(startMs: number, endMs: number): void {
    this.loop = { startMs, endMs };
  }

  clearLoop(): void {
    this.loop = null;
  }

  getCurrentTimeMs(): number {
    return (this.art?.currentTime ?? 0) * 1000;
  }

  getDurationMs(): number {
    return (this.art?.duration ?? 0) * 1000;
  }

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.on(event, cb);
  }

  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.off(event, cb);
  }

  destroy(): void {
    this.art?.destroy();
    this.art = null;
    this.emitter.clear();
  }

  private setState(s: PlayerState): void {
    if (this.state !== s) {
      this.state = s;
      this.emitter.emit('statechange', s);
    }
  }
}
// #endif
