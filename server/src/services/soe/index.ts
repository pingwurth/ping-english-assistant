/**
 * SoeProvider 工厂：按 SOE_PROVIDER 环境变量切换实现（架构 §3.2 Provider 抽象约定）。
 */

import type { Env } from '../../config/env'
import { createAzureSoeProvider } from './azure.provider'
import { createMockSoeProvider } from './mock.provider'
import { createTencentSoeProvider } from './tencent.provider'
import type { SoeProvider } from './soe-provider'

export function createSoeProvider(env: Env): SoeProvider {
  switch (env.SOE_PROVIDER) {
    case 'azure':
      return createAzureSoeProvider(env)
    case 'tencent':
      return createTencentSoeProvider()
    case 'mock':
      return createMockSoeProvider()
  }
}

export type { SoeProvider, SoeInput, SoeEvaluateResponse } from './soe-provider'
