/**
 * SOE 语音评测设置 API — 读写 ~/.ping-eng/settings.json 的 soe section。
 * GET/PUT 返回给客户端的密钥一律掩码；PUT 端识别「掩码原样回传」并保留已存真值
 * （编辑对话框回填掩码、用户未改密钥时不会把掩码存回去）。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig, writeSoeConfig, maskSecret, type SoeSettingsConfig } from '@/lib/server-settings'
import { DEFAULT_SOE_PROXY_URL } from '@/lib/service-endpoints'
import { sameOriginGuard } from '@/lib/api-guard'

const PROVIDERS = new Set(['mock', 'azure', 'tencent', 'iflytek'])
const DEFAULT_CONFIG: SoeSettingsConfig = { provider: 'mock', proxyUrl: DEFAULT_SOE_PROXY_URL }

/** GET 返回前掩码密钥字段 */
function maskSoeCreds(config: SoeSettingsConfig): SoeSettingsConfig {
  const out: SoeSettingsConfig = { ...config }
  if (out.sharedToken) out.sharedToken = maskSecret(out.sharedToken)
  if (out.azure?.key) out.azure = { ...out.azure, key: maskSecret(out.azure.key) }
  if (out.tencent) {
    out.tencent = {
      ...out.tencent,
      secretId: maskSecret(out.tencent.secretId),
      secretKey: maskSecret(out.tencent.secretKey),
    }
  }
  if (out.iflytek) {
    out.iflytek = {
      ...out.iflytek,
      apiKey: maskSecret(out.iflytek.apiKey),
      apiSecret: maskSecret(out.iflytek.apiSecret),
    }
  }
  return out
}

/**
 * 可选 provider 密钥对象归一：仅保留非空字符串字段；全空 → undefined。
 * 提交值与已存密钥的掩码形式相同 → 视为「未修改」，保留已存真值。
 */
function normalizeCreds(
  v: unknown,
  keys: readonly string[],
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (typeof v !== 'object' || v === null) return undefined
  const out: Record<string, string> = {}
  for (const k of keys) {
    const val = (v as Record<string, unknown>)[k]
    if (typeof val !== 'string' || !val.trim()) continue
    const trimmed = val.trim()
    if (stored?.[k] && trimmed === maskSecret(stored[k])) {
      out[k] = stored[k] // 掩码原样回传 = 用户没改这个密钥
    } else {
      out[k] = trimmed
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** sharedToken 归一：非空字符串生效（掩码原样回传 → 保留已存真值）；空/缺省 → 未配置（清除） */
function normalizeSharedToken(incoming: unknown, stored?: string): string | undefined {
  if (typeof incoming !== 'string') return undefined
  const v = incoming.trim()
  if (!v) return undefined
  if (stored && v === maskSecret(stored)) return stored
  return v
}

export async function GET(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const config = (await readSoeConfig()) ?? DEFAULT_CONFIG
    return NextResponse.json(maskSoeCreds(config))
  } catch {
    return NextResponse.json({ error: 'Failed to read SOE settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const { provider, proxyUrl, sharedToken, azure, tencent, iflytek } = body ?? {}

    if (typeof provider !== 'string' || !PROVIDERS.has(provider)) {
      return NextResponse.json({ error: 'provider 必须是 mock/azure/tencent/iflytek 之一' }, { status: 400 })
    }
    if (typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
      return NextResponse.json({ error: 'Missing required field: proxyUrl' }, { status: 400 })
    }

    const stored = await readSoeConfig()
    const config: SoeSettingsConfig = {
      provider: provider as SoeSettingsConfig['provider'],
      proxyUrl: proxyUrl.trim(),
      sharedToken: normalizeSharedToken(sharedToken, stored?.sharedToken),
      azure: normalizeCreds(azure, ['key', 'region', 'host'], stored?.azure) as SoeSettingsConfig['azure'],
      tencent: normalizeCreds(tencent, ['appId', 'secretId', 'secretKey'], stored?.tencent) as SoeSettingsConfig['tencent'],
      iflytek: normalizeCreds(iflytek, ['appId', 'apiKey', 'apiSecret'], stored?.iflytek) as SoeSettingsConfig['iflytek'],
    }
    await writeSoeConfig(config)
    // 回包同样只带掩码
    return NextResponse.json(maskSoeCreds(config))
  } catch {
    return NextResponse.json({ error: 'Failed to save SOE settings' }, { status: 500 })
  }
}
