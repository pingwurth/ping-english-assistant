/**
 * H5 录音适配器：Recorder.js（xiangyuecn / recorder-core，架构文档 §2.3）
 * 直接产出 WAV/PCM 16kHz，规避 MediaRecorder 输出 webm/mp4 的三端不一致问题。
 * iOS Safari 必须用户手势触发（录音按钮点击即满足）。
 */
// #ifdef H5
import Recorder from 'recorder-core';
import 'recorder-core/src/engine/wav';
import 'recorder-core/src/engine/pcm';
import type {
  RecordedAudio,
  RecorderController,
  RecorderError,
  RecorderEvents,
  RecordOptions
} from '@/core/recorder/types';
import { DEFAULT_RECORD_OPTIONS, RecorderEventEmitter } from '@/core/recorder/types';

interface RecorderInstance {
  open(success: () => void, fail: (msg: string, isUserNotAllow?: boolean) => void): void;
  start(): void;
  pause(): void;
  resume(): void;
  stop(
    success: (blob: Blob, duration: number) => void,
    fail: (msg: string) => void
  ): void;
  close(): void;
}

interface RecorderFactory {
  (options: {
    type: string;
    sampleRate: number;
    bitRate: number;
    onProcess?: (buffers: unknown, powerLevel: number) => void;
  }): RecorderInstance;
}

export class RecorderJsAdapter implements RecorderController {
  private emitter = new RecorderEventEmitter();
  private rec: RecorderInstance | null = null;
  private startedAt = 0;
  private options: RecordOptions = { ...DEFAULT_RECORD_OPTIONS };
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  start(options?: Partial<RecordOptions>): Promise<void> {
    this.options = { ...DEFAULT_RECORD_OPTIONS, ...options };
    return new Promise((resolve, reject) => {
      const factory = Recorder as unknown as RecorderFactory;
      this.rec = factory({
        type: this.options.format,
        sampleRate: this.options.sampleRate,
        bitRate: 16,
        onProcess: (_buffers, powerLevel) => {
          this.emitter.emit('volume', Math.min(1, powerLevel / 100));
        }
      });
      this.rec.open(
        () => {
          this.rec!.start();
          this.startedAt = Date.now();
          // 到达时长上限自动停止
          const maxMs = this.options.maxDurationMs ?? 600000;
          this.maxTimer = setTimeout(() => {
            this.emitter.emit('maxreach');
            void this.stop();
          }, maxMs);
          resolve();
        },
        (msg, isUserNotAllow) => {
          const err: RecorderError = {
            code: isUserNotAllow ? 'permission-denied' : 'not-supported',
            message: msg || '录音初始化失败'
          };
          this.emitter.emit('error', err);
          reject(err);
        }
      );
    });
  }

  pause(): void {
    this.rec?.pause();
  }

  resume(): void {
    this.rec?.resume();
  }

  stop(): Promise<RecordedAudio> {
    this.clearMaxTimer();
    return new Promise((resolve, reject) => {
      if (!this.rec) {
        reject(new Error('录音未开始'));
        return;
      }
      const rec = this.rec;
      this.rec = null;
      rec.stop(
        (blob, duration) => {
          rec.close();
          resolve({
            blob,
            durationMs: duration || Date.now() - this.startedAt,
            sampleRate: this.options.sampleRate
          });
        },
        (msg) => {
          rec.close();
          reject(new Error(msg || '录音结束失败'));
        }
      );
    });
  }

  cancel(): void {
    this.clearMaxTimer();
    this.rec?.close();
    this.rec = null;
  }

  on<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void {
    this.emitter.on(event, cb);
  }

  destroy(): void {
    this.cancel();
    this.emitter.clear();
  }

  private clearMaxTimer(): void {
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
  }
}
// #endif
