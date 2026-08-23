/**
 * Fastify 实例装配（架构文档 §3.2 app.ts）
 * 中间件：CORS / 限流 / multipart / 错误规范化。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { AppConfig } from './config/env.js';
import { toErrorBody } from './lib/errors.js';
import { asrRoutes } from './routes/asr.route.js';
import { soeRoutes } from './routes/soe.route.js';
import { ttsRoutes } from './routes/tts.route.js';
import { reportRoutes } from './routes/report.route.js';
import { explainRoutes } from './routes/explain.route.js';

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' },
    bodyLimit: 25 * 1024 * 1024
  });

  // CORS：白名单 = H5 部署域名；空 = 开发期允许所有（§3.5）
  await app.register(cors, {
    origin: config.corsOriginList.length > 0 ? config.corsOriginList : true,
    exposedHeaders: ['X-Tts-Task-Id', 'X-Tts-Duration-Ms', 'X-Tts-Sentence-Count']
  });

  // 限流（§3.5）：默认 100 次/分钟/IP；关键路由单独收紧
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      code: 'rate-limited',
      message: '请求过于频繁，请稍后再试'
    })
  });

  // multipart：单文件 ≤25MB（Whisper 上限，§3.3）
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1 }
  });

  // 错误规范化
  app.setErrorHandler((err, _req, reply) => {
    if (err.statusCode === 429) {
      return reply.status(429).send({ code: 'rate-limited', message: '请求过于频繁，请稍后再试' });
    }
    const { statusCode, body } = toErrorBody(err);
    return reply.status(statusCode).send(body);
  });

  // 健康检查（部署探活，§7）
  app.get('/health', async () => ({ status: 'ok', ts: Date.now() }));

  // 业务路由
  await app.register(asrRoutes, config);
  await app.register(soeRoutes, config);
  await app.register(ttsRoutes, config);
  await app.register(reportRoutes, config);
  await app.register(explainRoutes, config);

  return app;
}
