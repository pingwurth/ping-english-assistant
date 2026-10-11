/**
 * Fastify 实例装配 —— 真源：docs/系统架构设计.md §3.2（app.ts + plugins + routes）。
 * 无状态无库；CORS 面向前端 dev（Next 3000 / 局域网 H5）；错误统一 { code, message, detail? }。
 */

import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type { Env } from './config/env'
import { ApiError, ERR } from './lib/api-error'
import { buildSoeRoute } from './routes/soe.route'
import { createSoeProviderRegistry } from './services/soe'

export async function buildApp(env: Env, opts?: { logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts?.logger ?? true, bodyLimit: 32 * 1024 * 1024 })
  const soe = createSoeProviderRegistry(env)

  await app.register(cors, { origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()) })
  await app.register(multipart, {
    limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 5 }, // 音频 ≤25MB（架构 §3.3）
  })

  // 统一错误出口：ApiError → 自带状态码；multipart 的 413/400 保留状态、补齐 code；其余归一 500
  app.setErrorHandler((err: FastifyError | ApiError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      return reply.status(err.httpStatus).send({ code: err.code, message: err.message, detail: err.detail })
    }
    const status = (err as FastifyError).statusCode ?? 500
    if (status >= 400 && status < 500) {
      const code = status === 413 ? ERR.PAYLOAD_TOO_LARGE.code : ERR.BAD_REQUEST.code
      return reply.status(status).send({ code, message: err.message })
    }
    req.log.error(err)
    return reply.status(500).send({ code: ERR.INTERNAL.code, message: '服务器内部错误' })
  })

  // soeProvider 保留旧探活兼容；soeProviders 为当前已配置凭据的全部实现
  app.get('/healthz', async () => ({
    ok: true,
    soeProvider: soe.defaultName,
    soeProviders: [...soe.providers.keys()],
  }))

  await app.register(buildSoeRoute(soe, env))
  return app
}
