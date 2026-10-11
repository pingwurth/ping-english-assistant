/**
 * env 加载与校验（zod）—— 真源：docs/系统架构设计.md §3.2（config/ env 加载与校验）。
 * 零依赖读 .env（server 目录下），已有同名环境变量不覆盖。
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8788),
  HOST: z.string().default('0.0.0.0'),
  /** 前端来源，逗号分隔（Next dev 与局域网 H5） */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  SOE_PROVIDER: z.enum(['mock', 'azure', 'tencent']).default('mock'),
  AZURE_SPEECH_REGION: z.string().optional(),
  /** 自定义域名资源（如 https://my-speech.cognitiveservices.azure.com）；设置后优先于 REGION */
  AZURE_SPEECH_HOST: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  /** 上游超时与重试（报告 §6.1：10s / 重试 1 次） */
  SOE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SOE_RETRY: z.coerce.number().int().min(0).max(3).default(1),
})

export type Env = z.infer<typeof envSchema>

/** 极简 .env 解析：KEY=VALUE 行，# 注释，不展开变量 */
function loadDotEnv(path = '.env'): void {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return // 无 .env 文件：纯环境变量运行（容器/CI）
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key in process.env) continue
    process.env[key] = value
  }
}

export function loadEnv(): Env {
  loadDotEnv()
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`环境变量校验失败：${issues}`)
  }
  const env = parsed.data

  // 跨字段约束：azure 必须有密钥与端点
  if (env.SOE_PROVIDER === 'azure') {
    if (!env.AZURE_SPEECH_KEY) throw new Error('SOE_PROVIDER=azure 需要 AZURE_SPEECH_KEY')
    if (!env.AZURE_SPEECH_HOST && !env.AZURE_SPEECH_REGION) {
      throw new Error('SOE_PROVIDER=azure 需要 AZURE_SPEECH_REGION 或 AZURE_SPEECH_HOST 其一')
    }
    if (env.AZURE_SPEECH_HOST && !/^https?:\/\//.test(env.AZURE_SPEECH_HOST)) {
      throw new Error('AZURE_SPEECH_HOST 必须以 http(s):// 开头')
    }
  }
  return env
}
