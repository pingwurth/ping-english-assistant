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

import type { AppServices } from './contracts'
import { MockAsrService, type MockAsrOptions } from './mock/asr'
import { MockSoeService, type MockSoeOptions } from './mock/soe'
import { MockRecitationReportService, MockShadowingReportService, type MockReportOptions } from './mock/report'
import { MockTtsService, type MockTtsOptions } from './mock/tts'
import { MockMnemonicService, type MockMnemonicOptions } from './mock/mnemonic'

/** mock 聚合（批次 E 起为完整 AppServices，含 tts） */
export interface MockServices extends AppServices {}

export interface MockServicesOptions {
  asr?: MockAsrOptions
  soe?: MockSoeOptions
  /** 影子跟读与背诵报告共用同一组配置 */
  report?: MockReportOptions
  tts?: MockTtsOptions
  mnemonic?: MockMnemonicOptions
}

/** 获取 mock 服务集（确定性、离线可用、零网络） */
export function getMockServices(options: MockServicesOptions = {}): MockServices {
  return {
    asr: new MockAsrService(options.asr),
    soe: new MockSoeService(options.soe),
    shadowingReport: new MockShadowingReportService(options.report),
    recitationReport: new MockRecitationReportService(options.report),
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

/** 契约类型再导出，供上层（stores/页面）统一从 services 入口引用 */
export type {
  AppServices,
  AsrService,
  SoeService,
  ShadowingReportService,
  RecitationReportService,
  TtsService,
  MnemonicService,
} from './contracts'
export { ApiError, toApiError, throwIfAborted, abortableDelay } from './contracts'
export type { ApiErrorPayload, SoeEvalMode, TtsGenerateResult } from './contracts'
