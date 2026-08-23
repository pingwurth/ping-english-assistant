/**
 * ASR Provider 接口（架构文档 §3.2 Provider 抽象）
 * 环境变量切换实现（ASR_PROVIDER=whisper|xunfei），对应降级策略。
 */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  durationMs: number;
  segments: TranscriptSegment[];
}

export interface AsrProvider {
  /** audioFilePath：wav/pcm 16kHz mono；lang: "en" */
  transcribe(audioFilePath: string, lang: string): Promise<TranscriptResult>;
}
