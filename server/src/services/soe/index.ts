/**
 * SoeProvider 注册表 —— mock 恒在；其余按已配置凭据构造。
 * 默认实现取 SOE_PROVIDER；请求可用 multipart 字段 provider 覆盖（仅限已注册实现）。
 * 请求还可带 creds 字段（JSON，请求级密钥）——优先于 env，经 resolveSoeProvider 现场构造。
 */

import { azureCredsOk, iflytekCredsOk, providerCredsOk, tencentCredsOk, type Env } from '../../config/env'
import { createAzureSoeProvider } from './azure.provider'
import { createIflytekSoeProvider } from './iflytek.provider'
import { createMockSoeProvider } from './mock.provider'
import { createTencentSoeProvider } from './tencent.provider'
import type { SoeProvider, SoeProviderName } from './soe-provider'

export interface SoeProviderRegistry {
  /** SOE_PROVIDER env（默认实现） */
  readonly defaultName: SoeProviderName
  /** mock 恒在；其余按凭据构造 */
  readonly providers: ReadonlyMap<SoeProviderName, SoeProvider>
}

export function createSoeProviderRegistry(env: Env): SoeProviderRegistry {
  const providers = new Map<SoeProviderName, SoeProvider>()
  providers.set('mock', createMockSoeProvider())
  if (azureCredsOk(env)) providers.set('azure', createAzureSoeProvider(env))
  if (tencentCredsOk(env)) providers.set('tencent', createTencentSoeProvider(env))
  if (iflytekCredsOk(env)) providers.set('iflytek', createIflytekSoeProvider(env))
  return { defaultName: env.SOE_PROVIDER, providers }
}

/** 请求级密钥（multipart creds 字段的 JSON 形态；字段全可选） */
export interface SoeRequestCreds {
  azure?: { key?: string; region?: string; host?: string }
  tencent?: { appId?: string; secretId?: string; secretKey?: string }
  iflytek?: { appId?: string; apiKey?: string; apiSecret?: string }
}

/** 请求级密钥解析：请求密钥优先于 env（合并后凭据齐全 → 现场构造 provider）；否则回落 registry */
export function resolveSoeProvider(
  registry: SoeProviderRegistry,
  env: Env,
  name: SoeProviderName,
  creds?: SoeRequestCreds,
): SoeProvider | undefined {
  // mock 与未携带请求密钥：密钥无关，直接取注册表现状
  if (name === 'mock' || !creds || !creds[name]) return registry.providers.get(name)

  // 合并 env 与请求密钥（同名时请求胜出；空串视为未提供，不覆盖 env）
  const merged: Env = { ...env }
  const has = (v: string | undefined): v is string => typeof v === 'string' && v !== ''
  const { azure, tencent, iflytek } = creds
  if (azure) {
    if (has(azure.key)) merged.AZURE_SPEECH_KEY = azure.key
    if (has(azure.region)) merged.AZURE_SPEECH_REGION = azure.region
    if (has(azure.host)) merged.AZURE_SPEECH_HOST = azure.host
  }
  if (tencent) {
    if (has(tencent.appId)) merged.TENCENT_APP_ID = tencent.appId
    if (has(tencent.secretId)) merged.TENCENT_SECRET_ID = tencent.secretId
    if (has(tencent.secretKey)) merged.TENCENT_SECRET_KEY = tencent.secretKey
  }
  if (iflytek) {
    if (has(iflytek.appId)) merged.IFLYTEK_APP_ID = iflytek.appId
    if (has(iflytek.apiKey)) merged.IFLYTEK_API_KEY = iflytek.apiKey
    if (has(iflytek.apiSecret)) merged.IFLYTEK_API_SECRET = iflytek.apiSecret
  }

  // 合并后凭据仍不齐 → 回落注册表（可能未注册，调用方按 503 处理）
  if (!providerCredsOk(merged, name)) return registry.providers.get(name)

  // 现场构造（廉价闭包，无需缓存）
  switch (name) {
    case 'azure':
      return createAzureSoeProvider(merged)
    case 'tencent':
      return createTencentSoeProvider(merged)
    case 'iflytek':
      return createIflytekSoeProvider(merged)
  }
}

export type { SoeProvider, SoeProviderName, SoeInput, SoeEvaluateResponse } from './soe-provider'
