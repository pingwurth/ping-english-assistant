/**
 * 小程序录音适配器：RecorderManager（架构文档 §2.3）
 * format: 'pcm'、sampleRate: 16000、单声道；
 * 边播边录时按设置引导 audioSource（回声消除 vs 音质权衡）。
 */
// #ifdef MP-WEIXIN
import type {
  RecordedAudio,
  RecorderController,
  RecorderError,
  RecorderEvents,
  RecordOptions
} from '@/core/recorder/types';
import { DEFAULT_RECORD_OPTIONS, RecorderEventEmitter } from '@/core/recorder/types';

export class WxRecorderAdapter implements RecorderController {
  private emitter = new RecorderEventEmitter();
  private manager = uni.getRecorderManager();
  private startedAt = 0;
  private options: RecordOptions = { ...DEFAULT_RECORD_OPTIONS };
  private stopResolve: ((audio: RecordedAudio) => void) | null = null;
  private stopReject: ((err: Error) => void) | null = null;
  private bound = false;

  start(options?: Partial<RecordOptions>): Promise<void> {
    this.options = { ...DEFAULT_RECORD_OPTIONS, ...options };
    this.bindOnce();
    return new Promise((resolve, reject) => {
      uni.authorize({
        scope: 'scope.record',
        success: () => {
          this.manager.start({
            format: this.options.format,
            sampleRate: this.options.sampleRate,
            numberOfChannels: this.options.channels,
            encodeBitRate: 96000,
            duration: this.options.maxDurationMs ?? 600000
          });
          this.startedAt = Date.now();
          resolve();
        },
        fail: () => {
          const err: RecorderError = {
            code: 'permission-denied',
            message: '麦克风权限被拒绝，请在设置中开启'
          };
          this.emitter.emit('error', err);
          reject(err);
        }
      });
    });
  }

  pause(): void {
    this.manager.pause();
  }

  resume(): void {
    this.manager.resume();
  }

  stop(): Promise<RecordedAudio> {
    return new Promise((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
      this.manager.stop();
    });
  }

  cancel(): void {
    this.stopResolve = null;
    this.stopReject = null;
    this.manager.stop();
  }

  on<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void {
    this.emitter.on(event, cb);
  }

  destroy(): void {
    this.emitter.clear();
  }

  private bindOnce(): void {
    if (this.bound) return;
    this.bound = true;
    this.manager.onStop((res) => {
      const audio: RecordedAudio = {
        tempFilePath: res.tempFilePath,
        durationMs: res.duration ?? Date.now() - this.startedAt,
        sampleRate: this.options.sampleRate
      };
      this.stopResolve?.(audio);
      this.stopResolve = null;
      this.stopReject = null;
    });
    this.manager.onError((err) => {
      const e: RecorderError = { code: 'unknown', message: err.errMsg || '录音失败', detail: err };
      this.emitter.emit('error', e);
      this.stopReject?.(new Error(e.message));
      this.stopResolve = null;
      this.stopReject = null;
    });
    this.manager.onPause(() => undefined);
    // 到达 duration 上限时 RecorderManager 自动触发 onStop
    this.manager.onStart(() => undefined);
  }
}
// #endif
