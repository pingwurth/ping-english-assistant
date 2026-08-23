/**
 * 训练报告路由（架构文档 §3.3-③④ · §5.4 ADR-6 两段式）
 * POST /api/v1/reports/shadowing — 影子跟读报告（SSE）
 * POST /api/v1/reports/recitation — 全文背诵报告（SSE）
 *
 * LLM 报告按 hash(transcript+sentences) 缓存 1 小时（§3.5）。
 * 小程序 wx.request 不支持流式：Accept 非 SSE 时聚合后返回完整 JSON。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Errors } from '../lib/errors.js';
import { LruCache } from '../lib/lru.js';
import { SseWriter, acceptsSse } from '../lib/sse.js';
import type { AppConfig } from '../config/env.js';
import type { LlmProvider } from '../services/llm/llm-provider.js';
import { splitReportOutput } from '../services/llm/llm-provider.js';
import { OpenAiLlmProvider } from '../services/llm/openai.provider.js';
import { AnthropicLlmProvider } from '../services/llm/anthropic.provider.js';

const reportCache = new LruCache<{ markdown: string; result: Record<string, unknown> }>(
  100,
  3600_000
);

const bodySchema = z.object({
  transcript: z.string().min(1),
  sentences: z.array(
    z.object({
      index: z.number().int(),
      textEn: z.string(),
      textZh: z.string().nullable()
    })
  ),
  materialTitle: z.string().default('')
});

type ReportBody = z.infer<typeof bodySchema>;
type ReportMode = 'shadowing' | 'recitation';

function createLlmProvider(config: AppConfig): LlmProvider {
  return config.LLM_PROVIDER === 'anthropic'
    ? new AnthropicLlmProvider(config)
    : new OpenAiLlmProvider(config);
}

async function loadPromptTemplate(mode: ReportMode): Promise<string> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../prompts');
  return readFile(join(dir, `${mode}.md`), 'utf8');
}

function renderPrompt(template: string, body: ReportBody): string {
  const sentencesText = body.sentences
    .map((s) => `${s.index + 1}. ${s.textEn}${s.textZh ? `（${s.textZh}）` : ''}`)
    .join('\n');
  return template
    .replace('{{sentences}}', sentencesText)
    .replace('{{transcript}}', body.transcript)
    .replace('{{materialTitle}}', body.materialTitle);
}

export async function reportRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const llm = createLlmProvider(config);

  for (const mode of ['shadowing', 'recitation'] as const) {
    app.post(`/api/v1/reports/${mode}`, async (req, reply) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.badRequest('参数错误：' + parsed.error.issues.map((i) => i.message).join('; '));
      }
      const body = parsed.data;
      const cacheKey = createHash('sha256')
        .update(mode + body.transcript + JSON.stringify(body.sentences))
        .digest('hex');

      const cached = reportCache.get(cacheKey);
      const wantSse = acceptsSse(reply);

      if (cached) {
        if (wantSse) {
          const sse = new SseWriter(reply);
          sse.status('analyzing');
          sse.token(cached.markdown);
          sse.result(cached.result);
          sse.done();
          return;
        }
        return { markdown: cached.markdown, result: cached.result };
      }

      if (!wantSse) {
        // 小程序降级：聚合完整结果一次性返回
        const aggregate = await runReport(llm, await loadPromptTemplate(mode), body, () => undefined);
        reportCache.set(cacheKey, aggregate);
        return { markdown: aggregate.markdown, result: aggregate.result };
      }

      reply.hijack();
      const sse = new SseWriter(reply);
      sse.status('analyzing');
      try {
        const aggregate = await runReport(llm, await loadPromptTemplate(mode), body, (t) => sse.token(t));
        reportCache.set(cacheKey, aggregate);
        sse.result(aggregate.result);
        sse.done();
      } catch (e) {
        sse.error(e instanceof Error ? e.message : 'AI 分析失败');
      }
    });
  }
}

async function runReport(
  llm: LlmProvider,
  template: string,
  body: ReportBody,
  onToken: (t: string) => void
): Promise<{ markdown: string; result: Record<string, unknown> }> {
  const prompt = renderPrompt(template, body);
  const full = await llm.streamChat(prompt, onToken);
  const { markdown, scores } = splitReportOutput(full);
  return { markdown: markdown || full, result: { ...(scores ?? {}) } };
}
