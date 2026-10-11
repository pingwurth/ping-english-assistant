/**
 * env 加载与校验（zod）—— 真源：docs/系统架构设计.md §3.2（config/ env 加载与校验）。
 * 零依赖读 .env（server 目录下），已有同名环境变量不覆盖。
 */

import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8788),
  HOST: z.string().default('0.0.0.0'),
  /** 前端来源，逗号分隔（Next dev 与局域网 H5） */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  SOE_PROVIDER: z.enum(['mock', 'azure', 'tencent', 'iflytek']).default('mock'),
  AZURE_SPEECH_REGION: z.string().optional(),
  /** 自定义域名资源（如 https://my-speech.cognitiveservices.azure.com）；设置后优先于 REGION */
  AZURE_SPEECH_HOST: z.string().optional(),
  AZURE_SPEECH_KEY: z.string().optional(),
  /** 腾讯云智聆口语评测：访问管理 CAM → API 密钥管理 */
  TENCENT_SECRET_ID: z.string().optional(),
  TENCENT_SECRET_KEY: z.string().optional(),
  /** 科大讯飞 ISE 流式版：控制台「语音评测」应用三件套 */
  IFLYTEK_APP_ID: z.string().optional(),
  IFLYTEK_API_KEY: z.string().optional(),
  IFLYTEK_API_SECRET: z.string().optional(),
  /** 讯飞音频分帧发送间隔（官方建议 40ms/1280B；0 = 不等待） */
  IFLYTEK_FRAME_INTERVAL_MS: z.coerce.number().int().min(0).max(200).default(40),
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

/** Azure 凭据齐备：密钥 + 端点（REGION/HOST 其一） */
export function azureCredsOk(env: Env): boolean {
  return Boolean(env.AZURE_SPEECH_KEY && (env.AZURE_SPEECH_HOST || env.AZURE_SPEECH_REGION))
}

/** 腾讯凭据齐备：SecretId + SecretKey */
export function tencentCredsOk(env: Env): boolean {
  return Boolean(env.TENCENT_SECRET_ID && env.TENCENT_SECRET_KEY)
}

/** 讯飞凭据齐备：APP_ID + API_KEY + API_SECRET 三件全填 */
export function iflytekCredsOk(env: Env): boolean {
  return Boolean(env.IFLYTEK_APP_ID && env.IFLYTEK_API_KEY && env.IFLYTEK_API_SECRET)
}

/** 指定 provider 凭据是否齐备（mock 无需凭据）——注册表构造与启动校验共用 */
export function providerCredsOk(env: Env, name: Env['SOE_PROVIDER']): boolean {
  switch (name) {
    case 'mock':
      return true
    case 'azure':
      return azureCredsOk(env)
    case 'tencent':
      return tencentCredsOk(env)
    case 'iflytek':
      return iflytekCredsOk(env)
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

  // 跨字段约束：仅「默认 provider」凭据缺失才启动失败；
  // 非默认 provider 允许暂缺凭据（不注册，请求指定时返回 503 PROVIDER_UNAVAILABLE）
  if (!providerCredsOk(env, env.SOE_PROVIDER)) {
    switch (env.SOE_PROVIDER) {
      case 'azure':
        if (!env.AZURE_SPEECH_KEY) throw new Error('SOE_PROVIDER=azure 需要 AZURE_SPEECH_KEY')
        throw new Error('SOE_PROVIDER=azure 需要 AZURE_SPEECH_REGION 或 AZURE_SPEECH_HOST 其一')
      case 'tencent':
        throw new Error('SOE_PROVIDER=tencent 需要 TENCENT_SECRET_ID 与 TENCENT_SECRET_KEY')
      case 'iflytek':
        throw new Error('SOE_PROVIDER=iflytek 需要 IFLYTEK_APP_ID / IFLYTEK_API_KEY / IFLYTEK_API_SECRET')
      case 'mock':
        break // 不可达：mock 恒通过
    }
  }

  // HOST 协议校验：只要配置了（无论是否默认 provider）就提前暴露坏配置
  if (env.AZURE_SPEECH_HOST && !/^https?:\/\//.test(env.AZURE_SPEECH_HOST)) {
    throw new Error('AZURE_SPEECH_HOST 必须以 http(s):// 开头')
  }
  return env
}
