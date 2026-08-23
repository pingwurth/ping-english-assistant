/**
 * 环境变量加载与校验（架构文档 §3.2 config/）
 * 密钥全部存 .env（不入仓），zod 启动校验缺失即拒启。
 */
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),

  OPENAI_API_KEY: z.string().default(''),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),

  TENCENT_SOE_SECRET_ID: z.string().default(''),
  TENCENT_SOE_SECRET_KEY: z.string().default(''),

  ASR_PROVIDER: z.enum(['whisper', 'xunfei']).default('whisper'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  TTS_PROVIDER: z.enum(['kokoro', 'azure']).default('kokoro'),

  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-latest'),

  XUNFEI_APP_ID: z.string().default(''),
  XUNFEI_API_KEY: z.string().default(''),
  XUNFEI_API_SECRET: z.string().default(''),

  CORS_ORIGINS: z.string().default(''),
  RECORDING_RETENTION_HOURS: z.coerce.number().min(0).default(0),
  KOKORO_MODEL_CACHE_DIR: z.string().default('./.cache/kokoro')
});

export type AppConfig = z.infer<typeof schema> & { corsOriginList: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`环境变量校验失败: ${issues}`);
  }
  const cfg = parsed.data;
  // 启动硬性校验：所选 provider 的密钥必须存在
  if (cfg.ASR_PROVIDER === 'whisper' && !cfg.OPENAI_API_KEY) {
    throw new Error('环境变量缺失: OPENAI_API_KEY（ASR_PROVIDER=whisper 时必需）');
  }
  if (cfg.LLM_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) {
    throw new Error('环境变量缺失: OPENAI_API_KEY（LLM_PROVIDER=openai 时必需）');
  }
  if (cfg.LLM_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) {
    throw new Error('环境变量缺失: ANTHROPIC_API_KEY（LLM_PROVIDER=anthropic 时必需）');
  }
  if (cfg.ASR_PROVIDER === 'xunfei' && (!cfg.XUNFEI_APP_ID || !cfg.XUNFEI_API_KEY || !cfg.XUNFEI_API_SECRET)) {
    throw new Error('环境变量缺失: XUNFEI_APP_ID / XUNFEI_API_KEY / XUNFEI_API_SECRET');
  }
  return {
    ...cfg,
    corsOriginList: cfg.CORS_ORIGINS ? cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : []
  };
}
