/**
 * SoeProvider 注册表 —— mock 恒在；其余按已配置凭据构造。
 * 默认实现取 SOE_PROVIDER；请求可用 multipart 字段 provider 覆盖（仅限已注册实现）。
 */

import { azureCredsOk, iflytekCredsOk, tencentCredsOk, type Env } from '../../config/env'
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

export type { SoeProvider, SoeProviderName, SoeInput, SoeEvaluateResponse } from './soe-provider'
