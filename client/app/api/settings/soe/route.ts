/**
 * SOE 语音评测设置 API — 读写 ~/.ping-eng/settings.json 的 soe section。
 * 单用户本机应用：GET 原样返回密钥（与 llm-configs 编辑回填口径一致）。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig, writeSoeConfig, type SoeSettingsConfig } from '@/lib/server-settings'
import { DEFAULT_SOE_PROXY_URL } from '@/lib/service-endpoints'

const PROVIDERS = new Set(['mock', 'azure', 'tencent', 'iflytek'])
const DEFAULT_CONFIG: SoeSettingsConfig = { provider: 'mock', proxyUrl: DEFAULT_SOE_PROXY_URL }

/** 可选 provider 密钥对象归一：仅保留非空字符串字段；全空 → undefined */
function normalizeCreds(v: unknown, keys: readonly string[]): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Record<string, string> = {}
  for (const k of keys) {
    const val = (v as Record<string, unknown>)[k]
    if (typeof val === 'string' && val.trim()) out[k] = val.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export async function GET() {
  try {
    const config = (await readSoeConfig()) ?? DEFAULT_CONFIG
    return NextResponse.json(config)
  } catch {
    return NextResponse.json({ error: 'Failed to read SOE settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { provider, proxyUrl, azure, tencent, iflytek } = body ?? {}

    if (typeof provider !== 'string' || !PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'provider 必须是 mock/azure/tencent/iflytek 之一' }, { status: 400 })
    }
    if (typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
      return NextResponse.json({ error: 'Missing required field: proxyUrl' }, { status: 400 })
    }

    const config: SoeSettingsConfig = {
      provider: provider as SoeSettingsConfig['provider'],
      proxyUrl: proxyUrl.trim(),
      azure: normalizeCreds(azure, ['key', 'region', 'host']) as SoeSettingsConfig['azure'],
      tencent: normalizeCreds(tencent, ['secretId', 'secretKey']) as SoeSettingsConfig['tencent'],
      iflytek: normalizeCreds(iflytek, ['appId', 'apiKey', 'apiSecret']) as SoeSettingsConfig['iflytek'],
    }
    await writeSoeConfig(config)
    return NextResponse.json(config)
  } catch {
    return NextResponse.json({ error: 'Failed to save SOE settings' }, { status: 500 })
  }
}
