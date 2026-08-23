/**
 * SOE 发音评分代理路由（架构文档 §3.3-② · §5.3）
 * Web/H5 端跟读评分；小程序端走 SDK 直连不调此接口。
 * 相同音频哈希 + refText 的结果内存缓存 10 分钟（LRU 1000 条，§3.5）。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { Errors } from '../lib/errors.js';
import { LruCache } from '../lib/lru.js';
import { cleanup, saveUpload } from '../lib/tempfiles.js';
import type { AppConfig } from '../config/env.js';
import { SoeClient, type SoeScoreReport } from '../services/soe/soe.client.js';

const cache = new LruCache<SoeScoreReport>(1000, 10 * 60_000);

export async function soeRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const client = new SoeClient(config);

  app.post('/api/v1/soe/evaluate', async (req) => {
    const mp = await req.file();
    if (!mp) throw Errors.badRequest('缺少音频文件（字段名 audio）');
    const fields = mp.fields as Record<string, { value?: string } | undefined>;
    const refText = fields.refText?.value?.trim();
    if (!refText) throw Errors.badRequest('缺少参考文本 refText');
    const evalMode = fields.evalMode?.value === 'word' ? 'word' : 'sentence';

    const { path } = await saveUpload(mp.file, 'wav');
    try {
      const audio = await readFile(path);
      const cacheKey = `${createHash('sha256').update(audio).digest('hex')}:${refText}`;
      const hit = cache.get(cacheKey);
      if (hit) return hit;

      const report = await client.evaluate({ audio, refText, evalMode });
      cache.set(cacheKey, report);
      return report;
    } finally {
      await cleanup(path);
    }
  });
}
