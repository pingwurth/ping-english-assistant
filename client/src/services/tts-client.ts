/**
 * TTS 客户端（架构文档 §3.3-⑥⑦ · §5.5 链路）
 * POST /tts/generate → 音频二进制 + X-Tts-Task-Id；GET /tts/subtitle/:taskId → SRT。
 */
import { API_BASE_URL, ApiError, getJson } from './api-client';

export interface TtsGenerateInput {
  text: string;
  voice: string;
  speed: number;
  format?: 'wav' | 'mp3';
  withSubtitle?: boolean;
}

export interface TtsGenerateOutput {
  /** 音频二进制（H5 为 ArrayBuffer；小程序需经 wx.downloadFile 落地，见 ttsDownloadAudio） */
  arrayBuffer?: ArrayBuffer;
  taskId: string;
  durationMs: number;
  sentenceCount: number;
}

export const TTS_VOICES = [
  { id: 'af_heart', label: '美式 · Heart（女）' },
  { id: 'af_bella', label: '美式 · Bella（女）' },
  { id: 'am_michael', label: '美式 · Michael（男）' },
  { id: 'bf_emma', label: '英式 · Emma（女）' }
] as const;

export async function generateTts(input: TtsGenerateInput): Promise<TtsGenerateOutput> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: `${API_BASE_URL}/api/v1/tts/generate`,
      method: 'POST',
      data: {
        text: input.text,
        voice: input.voice,
        speed: input.speed,
        format: input.format ?? 'wav',
        withSubtitle: input.withSubtitle ?? true
      } as never,
      responseType: 'arraybuffer',
      success: (res) => {
        if (res.statusCode >= 400) {
          // arraybuffer 响应的错误体需解码
          let message = 'TTS 生成失败';
          try {
            const text = new TextDecoder().decode(res.data as ArrayBuffer);
            message = (JSON.parse(text) as { message?: string }).message ?? message;
          } catch {
            /* ignore */
          }
          reject(new ApiError('tts-error', message, res.statusCode));
          return;
        }
        const header = res.header ?? {};
        resolve({
          arrayBuffer: res.data as ArrayBuffer,
          taskId: header['X-Tts-Task-Id'] ?? header['x-tts-task-id'] ?? '',
          durationMs: Number(header['X-Tts-Duration-Ms'] ?? header['x-tts-duration-ms'] ?? 0),
          sentenceCount: Number(header['X-Tts-Sentence-Count'] ?? header['x-tts-sentence-count'] ?? 0)
        });
      },
      fail: (err) => reject(new ApiError('network-error', err.errMsg || '网络请求失败', 0))
    });
  });
}

export interface TtsSubtitle {
  srt: string;
  sentenceCount: number;
}

export function fetchTtsSubtitle(taskId: string): Promise<TtsSubtitle> {
  return getJson<TtsSubtitle>(`/api/v1/tts/subtitle/${encodeURIComponent(taskId)}`);
}

/** 试听小样：现场合成一句固定文本（原型设计 §4.12 声音选择） */
export function previewVoice(voice: string): Promise<TtsGenerateOutput> {
  return generateTts({
    text: 'Hello! This is a preview of the voice you selected.',
    voice,
    speed: 1.0,
    format: 'wav',
    withSubtitle: false
  });
}
