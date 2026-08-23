/**
 * TTS Provider 接口（架构文档 §3.2 · ADR-7）
 * Kokoro-82M 本地推理（默认）；Azure Speech 作质量备选/降级。
 */

export interface TtsInput {
  text: string;
  voice: string;
  /** 0.5 ~ 2.0 */
  speed: number;
  format: 'wav' | 'mp3';
}

export interface TtsSentence {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TtsResult {
  /** 编码后的音频文件内容 */
  audio: Buffer;
  durationMs: number;
  /** 分句合成得到的句级时间轴，用于生成 SRT（真实合成边界，非 ASR 推断） */
  sentences: TtsSentence[];
}

export interface TtsProvider {
  synthesize(input: TtsInput): Promise<TtsResult>;
  /** 启动预热常驻内存（Kokoro 本地推理）；远程 provider 可为空实现 */
  warmup?(): Promise<void>;
}
