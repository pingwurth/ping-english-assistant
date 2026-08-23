/**
 * 小程序视频播放适配器：原生 <video> + VideoContext（架构文档 §2.2）
 * 仅 MP-WEIXIN 端编译。页面需放置 <video id="mp-player"> 组件。
 */
// #ifdef MP-WEIXIN
import type {
  MediaSource,
  PlayerController,
  PlayerError,
  PlayerEvents,
  PlayerState
} from '@/core/player/types';
import { PlayerEventEmitter } from '@/core/player/types';

export class MpVideoAdapter implements PlayerController {
  private ctx: UniApp.VideoContext | null = null;
  private emitter = new PlayerEventEmitter();
  private state: PlayerState = 'idle';
  private durationMs = 0;
  private currentMs = 0;
  private loop: { startMs: number; endMs: number } | null = null;
  private src: MediaSource | null = null;

  /** 页面在 <video> 就绪后调用，注入 VideoContext */
  bind(videoId: string, component: unknown): void {
    this.ctx = uni.createVideoContext(videoId, component as never);
    if (this.src) void this.load(this.src);
  }

  /** 由页面 <video> 的 bindtimeupdate 转发（小程序回调间隔 100-250ms） */
  handleTimeupdate(currentSec: number, durationSec: number): void {
    this.currentMs = currentSec * 1000;
    this.durationMs = durationSec * 1000;
    // 循环边界判断使用 >= 加容差，防止回调间隔越过边界漏触发（架构文档 §5.1）
    if (this.loop && this.currentMs >= this.loop.endMs - 250) {
      this.seekTo(this.loop.startMs);
      return;
    }
    this.emitter.emit('timeupdate', this.currentMs);
  }

  handlePlay(): void {
    this.setState('playing');
  }

  handlePause(): void {
    this.setState('paused');
  }

  handleEnded(): void {
    this.setState('ended');
    this.emitter.emit('ended');
  }

  handleError(err: unknown): void {
    this.setState('error');
    this.emitter.emit('error', { code: 'media-error', message: '视频加载失败', detail: err } as PlayerError);
  }

  /** 页面读取视频源（模板绑定 :src） */
  get videoSrc(): string {
    return this.src?.src ?? '';
  }

  load(source: MediaSource): Promise<void> {
    this.src = source;
    this.setState('loading');
    // 小程序 <video> 的加载由组件完成；页面绑定 videoSrc 后自动就绪
    this.setState('ready');
    return Promise.resolve();
  }

  async play(): Promise<void> {
    this.ctx?.play();
  }

  pause(): void {
    this.ctx?.pause();
  }

  seekTo(ms: number): void {
    this.ctx?.seek(ms / 1000);
    this.currentMs = ms;
  }

  setRate(rate: number): void {
    (this.ctx as unknown as { playbackRate?: (r: number) => void })?.playbackRate?.(rate);
  }

  setVolume(_volume: number): void {
    // 小程序视频音量跟随系统（架构文档 §2.2）
  }

  setLoop(startMs: number, endMs: number): void {
    this.loop = { startMs, endMs };
  }

  clearLoop(): void {
    this.loop = null;
  }

  getCurrentTimeMs(): number {
    return this.currentMs;
  }

  getDurationMs(): number {
    return this.durationMs;
  }

  on<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.on(event, cb);
  }

  off<E extends keyof PlayerEvents>(event: E, cb: PlayerEvents[E]): void {
    this.emitter.off(event, cb);
  }

  destroy(): void {
    this.ctx = null;
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
