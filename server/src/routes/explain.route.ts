/**
 * 词典点查讲解路由（V1.3 预置，MVP 可不上线 · 架构文档 §3.3-⑤）
 * POST /api/v1/llm/explain — 单词/句子讲解（SSE）
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { SseWriter, acceptsSse } from '../lib/sse.js';
import type { AppConfig } from '../config/env.js';
import type { LlmProvider } from '../services/llm/llm-provider.js';
import { OpenAiLlmProvider } from '../services/llm/openai.provider.js';
import { AnthropicLlmProvider } from '../services/llm/anthropic.provider.js';

const bodySchema = z.object({
  target: z.string().min(1),
  context: z.string().default('')
});

export async function explainRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const llm: LlmProvider =
    config.LLM_PROVIDER === 'anthropic'
      ? new AnthropicLlmProvider(config)
      : new OpenAiLlmProvider(config);

  app.post('/api/v1/llm/explain', async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw Errors.badRequest('参数错误');
    const { target, context } = parsed.data;

    const dir = join(dirname(fileURLToPath(import.meta.url)), '../prompts');
    const template = await readFile(join(dir, 'explain.md'), 'utf8');
    const prompt = template.replace('{{target}}', target).replace('{{context}}', context);

    if (!acceptsSse(reply)) {
      const full = await llm.streamChat(prompt, () => undefined);
      return { markdown: full };
    }

    reply.hijack();
    const sse = new SseWriter(reply);
    try {
      const full = await llm.streamChat(prompt, (t) => sse.token(t));
      void full;
      sse.done();
    } catch (e) {
      sse.error(e instanceof Error ? e.message : '讲解生成失败');
    }
  });
}
