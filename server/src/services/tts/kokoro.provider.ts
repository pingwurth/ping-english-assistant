/**
 * Kokoro-82M TTS 本地推理 Provider（架构文档 §3.4 · ADR-7）
 * kokoro-js（Node 模式）加载 onnx-community/Kokoro-82M-v1.0-ONNX（q8，约 90MB），
 * 启动预热常驻内存（约 400-600MB）；
 * 按 [.!?;:\n] 分句逐句推理后拼接 24kHz PCM，
 * 累计每句 startMs/endMs 直接产出 SRT，无需 ASR 对齐。
 * 并发信号量 2（CPU 密集）；整体超时 120s。
 */
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { TtsInput, TtsProvider as ITtsProvider, TtsResult, TtsSentence } from './tts-provider.js';

const SAMPLE_RATE = 24000;
const MAX_CONCURRENCY = 2;
const TIMEOUT_MS = 120_000;

/** kokoro-js 动态导入（模型加载重，启动预热时调用一次） */
type KokoroTTS = {
  generate(text: string, options: { voice: string; speed: number }): Promise<{
    audio: Float32Array | { audio: Float32Array; sampling_rate: number };
    sampling_rate?: number;
  }>;
};

interface KokoroModule {
  KokoroTTS: {
    from_pretrained(modelId: string, options?: Record<string, unknown>): Promise<KokoroTTS>;
  };
}

export class KokoroProvider implements ITtsProvider {
  private tts: KokoroTTS | null = null;
  private loadPromise: Promise<KokoroTTS> | null = null;
  private inFlight = 0;
  private waiters: (() => void)[] = [];

  constructor(private config: AppConfig) {}

  /** 启动预热：避免首请求慢（架构文档 §8.1） */
  async warmup(): Promise<void> {
    await this.ensureLoaded();
  }

  private ensureLoaded(): Promise<KokoroTTS> {
    if (this.tts) return Promise.resolve(this.tts);
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        const mod = (await import('kokoro-js')) as unknown as KokoroModule;
        this.tts = await mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8',
          cache_dir: this.config.KOKORO_MODEL_CACHE_DIR
        });
        return this.tts;
      })();
      this.loadPromise.catch(() => {
        this.loadPromise = null; // 失败允许下次重试加载
      });
    }
    return this.loadPromise;
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    await this.acquire();
    try {
      return await withTimeout(this.synthesizeInner(input), TIMEOUT_MS);
    } finally {
      this.release();
    }
  }

  private async synthesizeInner(input: TtsInput): Promise<TtsResult> {
    const tts = await this.ensureLoaded();
    const sentences = splitSentences(input.text);
    if (sentences.length === 0) throw Errors.badRequest('文本为空');

    const pcmChunks: Float32Array[] = [];
    const timeline: TtsSentence[] = [];
    let cursorMs = 0;

    for (const sentence of sentences) {
      const out = await tts.generate(sentence, { voice: input.voice, speed: input.speed });
      const audio = 'audio' in out && out.audio instanceof Float32Array ? out.audio : (out as { audio: Float32Array }).audio;
      pcmChunks.push(audio);
      const durMs = Math.round((audio.length / SAMPLE_RATE) * 1000);
      timeline.push({ startMs: cursorMs, endMs: cursorMs + durMs, text: sentence });
      cursorMs += durMs;
    }

    const totalSamples = pcmChunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of pcmChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const wav = encodeWav(merged, SAMPLE_RATE);
    return { audio: wav, durationMs: cursorMs, sentences: timeline };
  }

  /** 并发信号量 2（CPU 密集） */
  private acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENCY) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(() => resolve())).then(() => {
      this.inFlight++;
    });
  }

  private release(): void {
    this.inFlight--;
    this.waiters.shift()?.();
  }
}

/** 按 [.!?;:\n] 分句（架构文档 §3.4） */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;:\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 24kHz mono Float32 PCM → WAV 编码 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Buffer {
  const numSamples = pcm.length;
  const dataSize = numSamples * 2; // 16-bit
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(Errors.timeout('kokoro')), ms))
  ]);
}
