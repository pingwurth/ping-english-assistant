/**
 * OpenAI Whisper ASR Provider（架构文档 §3.4）
 * 上传临时文件流式转发；失败按错误码重试一次；超时 60s。
 */
import { createReadStream } from 'node:fs';
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { AsrProvider, TranscriptResult, TranscriptSegment } from './asr-provider.js';

const TIMEOUT_MS = 60_000;

interface WhisperVerboseResponse {
  text: string;
  duration?: number;
  segments?: { start: number; end: number; text: string }[];
}

export class WhisperProvider implements AsrProvider {
  constructor(private config: AppConfig) {}

  async transcribe(audioFilePath: string, lang: string): Promise<TranscriptResult> {
    let lastErr: unknown = null;
    // 失败按错误码重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.callOnce(audioFilePath, lang);
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && 'statusCode' in e && (e as { statusCode: number }).statusCode < 500) {
          break; // 4xx 不重试
        }
      }
    }
    throw lastErr;
  }

  private async callOnce(audioFilePath: string, lang: string): Promise<TranscriptResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const form = new FormData();
      const fileStream = createReadStream(audioFilePath);
      const chunks: Buffer[] = [];
      for await (const chunk of fileStream) chunks.push(chunk as Buffer);
      const buf = Buffer.concat(chunks);
      form.append('file', new Blob([buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer]), 'audio.wav');
      form.append('model', 'whisper-1');
      form.append('language', lang);
      form.append('response_format', 'verbose_json');

      const res = await fetch(`${this.config.OPENAI_BASE_URL}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.OPENAI_API_KEY}` },
        body: form,
        signal: controller.signal
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw Errors.upstream('whisper', { status: res.status, body });
      }
      const data = (await res.json()) as WhisperVerboseResponse;
      const segments: TranscriptSegment[] = (data.segments ?? []).map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text.trim()
      }));
      return {
        text: data.text.trim(),
        durationMs: Math.round((data.duration ?? 0) * 1000),
        segments
      };
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw Errors.timeout('whisper');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
