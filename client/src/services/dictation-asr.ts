/**
 * 听写识别客户端（架构文档 §5.2 分端链路）
 * 小程序端：wechatSI 插件实时流式识别；Web/H5：录音上传后端 Whisper 代理。
 * 向上暴露同一接口 recognize(audio): Promise<string>。
 */
import { uploadMultipart } from './api-client';

export interface AsrTranscribeResult {
  text: string;
  durationMs: number;
  segments: { startMs: number; endMs: number; text: string }[];
}

/** 录音转写（影子跟读/背诵第一步；Web 端听写识别） */
export function recognize(audio: Blob | string, fileName = 'recording.wav'): Promise<string> {
  return transcribe(audio, fileName).then((r) => r.text);
}

export function transcribe(audio: Blob | string, fileName = 'recording.wav'): Promise<AsrTranscribeResult> {
  // #ifdef MP-WEIXIN
  // TODO(M4)：接入 wechatSI 插件实时识别；插件不可用时降级到后端 Whisper 通道（降级矩阵 §5.6）。
  // #endif
  return uploadMultipart<AsrTranscribeResult>('/api/v1/asr/transcribe', {
    file: audio,
    fileFieldName: 'audio',
    fileName,
    fields: { lang: 'en' }
  });
}

export interface ReportRequest {
  transcript: string;
  sentences: { index: number; textEn: string; textZh: string | null }[];
  materialTitle: string;
}
