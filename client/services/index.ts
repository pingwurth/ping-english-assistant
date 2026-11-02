/**
 * 服务工厂 —— 真源：docs/系统架构设计.md §3.1-3.3
 *
 * 当前原型仅有 mock 实现（离线可演示）。未来接入真实 Fastify 后端（§3.2 路由）后：
 *   1. 新增 services/api/*.ts，实现 contracts.ts 中的同名接口（契约不变，只换实现）；
 *   2. 在下方 getServices() 中按服务来源切换（预留环境变量，如
 *      NEXT_PUBLIC_SERVICE_MODE: 'mock' | 'api'，默认 'mock'）。
 *
 * 注意：TtsService 的 mock 实现已于批次 E 补齐（services/mock/tts.ts，契约⑥⑦），
 * getMockServices() / getServices() 均返回完整 AppServices（含 tts 字段）。
 */

import type { AppServices, SoeService } from './contracts'
import type { SoeSettingsConfig } from '@/lib/server-settings'
import { ApiSoeService } from './api/soe'
import { MockSoeService, type MockSoeOptions } from './mock/soe'
import { MockTtsService, type MockTtsOptions } from './mock/tts'
import { MockMnemonicService, type MockMnemonicOptions } from './mock/mnemonic'

/** mock 聚合（批次 E 起为完整 AppServices，含 tts） */
export interface MockServices extends AppServices {}

export interface MockServicesOptions {
  soe?: MockSoeOptions
  tts?: MockTtsOptions
  mnemonic?: MockMnemonicOptions
}

/**
 * 获取服务集（默认聚合）。注意各成员的真实语义：
 *   - soe/tts：本地确定性伪实现，零网络；
 *   - mnemonic：名为 Mock 但实际转发到 /api/mnemonic（真实 BFF/LLM）——
 *     见 services/mock/mnemonic.ts 文件头说明，并非离线伪数据。日后接入真实后端时应
 *     移入 services/api/ 并更名为 ApiMnemonicService，避免「mock」命名误导。
 */
export function getMockServices(options: MockServicesOptions = {}): MockServices {
  return {
    soe: new MockSoeService(options.soe),
    tts: new MockTtsService(options.tts),
    mnemonic: new MockMnemonicService(options.mnemonic),
  }
}

/** 服务来源切换预留：'mock' = 本地 mock；'api' = 真实 Fastify 后端（契约①-⑦） */
export type ServiceMode = 'mock' | 'api'

/**
 * 统一入口（当前恒返回 mock）：完整 AppServices（含 tts）。
 * 接入真实后端后在此读取 NEXT_PUBLIC_SERVICE_MODE 并返回 api 实现。
 */
export function getServices(_mode: ServiceMode = 'mock'): AppServices {
  // const mode = process.env.NEXT_PUBLIC_SERVICE_MODE === 'api' ? 'api' : 'mock'
  return getMockServices()
}

/** 缓存的评分服务：read-aloud 每句评分都会解析，不必每次都 fetch + 服务端重读 settings.json */
let soeServiceCache: SoeService | null = null

/** SOE 设置已变更（设置页保存成功后调用）：使缓存的评分服务失效，下次解析重新拉取 */
export function invalidateSoeServiceCache(): void {
  soeServiceCache = null
}

/** 跟读评分服务解析：模型设置的 soe 配置（settings.json）→ mock（本地伪评分）或 BFF 中转真实代理 */
export async function getSoeService(): Promise<SoeService> {
  if (soeServiceCache) return soeServiceCache

  let cfg: SoeSettingsConfig | null = null
  try {
    const r = await fetch('/api/settings/soe')
    cfg = r.ok ? ((await r.json()) as SoeSettingsConfig) : null
  } catch {
    cfg = null
  }
  if (!cfg) {
    // 拉取失败（settings.json 损坏、dev 抖动）≠ 未配置：回落 mock 伪评分必须大声警告，
    // 否则与发音无关的伪分会静默写进训练记录，用户以为在真评分
    console.warn('[services] SOE 设置读取失败，本次评分回落 mock 伪分（与发音无关，请检查设置）')
    return getMockServices().soe
  }
  soeServiceCache = cfg.provider === 'mock' ? getMockServices().soe : new ApiSoeService()
  return soeServiceCache
}

/** 契约类型再导出，供上层（stores/页面）统一从 services 入口引用 */
export type {
  AppServices,
  SoeService,
  TtsService,
  MnemonicService,
} from './contracts'
export { ApiError, toApiError, throwIfAborted, abortableDelay } from './contracts'
export type { ApiErrorPayload, SoeEvalMode, TtsGenerateResult } from './contracts'
