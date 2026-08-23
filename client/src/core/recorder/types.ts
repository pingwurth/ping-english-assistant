/**
 * RecorderController 抽象层接口（架构文档 §2.3 · ADR-5）
 * 录音统一 PCM/WAV 16kHz 单声道，同时满足腾讯 SOE 与 Whisper 输入要求。
 */

export interface RecordOptions {
  format: 'pcm' | 'wav';
  /** 固定 16kHz */
  sampleRate: 16000;
  /** 单声道 */
  channels: 1;
  /** 默认 600000（小程序硬上限 10 分钟） */
  maxDurationMs?: number;
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = {
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
  maxDurationMs: 600000
};

export interface RecordedAudio {
  /** H5 为 Blob（wav），小程序为本地临时文件路径（pcm/wav） */
  blob?: Blob;
  tempFilePath?: string;
  durationMs: number;
  sampleRate: number;
}

export interface RecorderError {
  code: 'permission-denied' | 'not-supported' | 'interrupted' | 'unknown';
  message: string;
  detail?: unknown;
}

export interface RecorderEvents {
  /** 驱动录音按钮声波动画 */
  volume: (level: number) => void;
  /** 到达时长上限自动停止 */
  maxreach: () => void;
  error: (err: RecorderError) => void;
}

export interface RecorderController {
  /** 内部申请麦克风权限 */
  start(options?: Partial<RecordOptions>): Promise<void>;
  /** 影子跟读/背诵可暂停 */
  pause(): void;
  resume(): void;
  stop(): Promise<RecordedAudio>;
  cancel(): void;
  on<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void;
  destroy(): void;
}

export class RecorderEventEmitter {
  private listeners = new Map<keyof RecorderEvents, Set<(...args: never[]) => void>>();

  on<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb as (...args: never[]) => void);
  }

  emit<E extends keyof RecorderEvents>(event: E, ...args: Parameters<RecorderEvents[E]>): void {
    this.listeners.get(event)?.forEach((cb) => {
      (cb as (...a: unknown[]) => void)(...args);
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
