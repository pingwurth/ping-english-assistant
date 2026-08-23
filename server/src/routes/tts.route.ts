/**
 * TTS 路由（架构文档 §3.3-⑥⑦ · v1.1 新增）
 * ⑥ POST /api/v1/tts/generate — 音频二进制 + X-Tts-Task-Id 头
 * ⑦ GET  /api/v1/tts/subtitle/:taskId — 领取生成的 SRT（LRU 500 条，TTL 10 分钟）
 *
 * 音频二进制与字幕分离返回，兼容小程序 wx.request(arraybuffer) 与 wx.downloadFile 两种落地方式。
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { LruCache } from '../lib/lru.js';
import type { AppConfig } from '../config/env.js';
import { KokoroProvider } from '../services/tts/kokoro.provider.js';
import type { TtsProvider } from '../services/tts/tts-provider.js';

/** TTS 字幕缓存（§3.3-⑦：LRU 500 条，TTL 10 分钟） */
const subtitleCache = new LruCache<{ srt: string; sentenceCount: number }>(500, 10 * 60_000);

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().default('af_heart'),
  speed: z.number().min(0.5).max(2).default(1.0),
  format: z.enum(['wav', 'mp3']).default('wav'),
  withSubtitle: z.boolean().default(true)
});

export function createTtsProvider(config: AppConfig): TtsProvider {
  // TTS_PROVIDER=azure 为质量备选/降级（ADR-7 退路），Azure 接入在后续迭代完成
  return new KokoroProvider(config);
}

/** 启动预热（Kokoro 模型常驻内存，避免首请求慢） */
export async function warmupTts(provider: TtsProvider): Promise<void> {
  await provider.warmup?.();
}

export async function ttsRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const provider = createTtsProvider(config);

  app.post('/api/v1/tts/generate', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw Errors.badRequest('参数错误：' + parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { text, voice, speed, format, withSubtitle } = parsed.data;
    // 剔除控制字符防滥用（§3.5 上传安全）
    const cleanText = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    if (!cleanText.trim()) throw Errors.badRequest('文本为空');

    const result = await provider.synthesize({ text: cleanText, voice, speed, format });

    const taskId = `tk_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    if (withSubtitle) {
      subtitleCache.set(taskId, {
        srt: buildSrt(result.sentences),
        sentenceCount: result.sentences.length
      });
    }

    return reply
      .header('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'audio/wav')
      .header('X-Tts-Task-Id', taskId)
      .header('X-Tts-Duration-Ms', String(result.durationMs))
      .header('X-Tts-Sentence-Count', String(result.sentences.length))
      // CORS 下前端可读取自定义头
      .header('Access-Control-Expose-Headers', 'X-Tts-Task-Id, X-Tts-Duration-Ms, X-Tts-Sentence-Count')
      .send(result.audio);
  });

  app.get('/api/v1/tts/subtitle/:taskId', async (req) => {
    const { taskId } = req.params as { taskId: string };
    const hit = subtitleCache.get(taskId);
    if (!hit) throw Errors.notFound('字幕不存在或已过期（10 分钟内有效）');
    return hit;
  });
}

/** 句级时间轴 → SRT 文本 */
function buildSrt(sentences: { startMs: number; endMs: number; text: string }[]): string {
  return sentences
    .map((s, i) => `${i + 1}\n${toSrtTs(s.startMs)} --> ${toSrtTs(s.endMs)}\n${s.text}\n`)
    .join('\n');
}

function toSrtTs(ms: number): string {
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const msec = Math.floor(ms % 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${pad(msec, 3)}`;
}
