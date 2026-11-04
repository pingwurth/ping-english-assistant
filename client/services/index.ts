/**
 * 服务工厂 —— 真源：docs/系统架构设计.md §3.1-3.3
 *
 * getServices() 返回服务聚合，各成员的真实语义：
 *   - soe：本地确定性伪实现，零网络（演示模式的评分走它；真实评分见 getSoeService）；
 *   - mnemonic：名为 Mock 但实际转发到 /api/mnemonic（真实 BFF/LLM）——
 *     见 services/mock/mnemonic.ts 文件头说明，并非离线伪数据。日后接入真实后端时应
 *     移入 services/api/ 并更名为 ApiMnemonicService，避免「mock」命名误导。
 *
 * 历史注：契约⑥⑦ TtsService（含 mock 实现/ServiceMode 切换脚手架）已于 2026-11 删除——
 * 真实 TTS 路径一直是 tts.tsx 页 → POST /api/tts（multipart，形状与旧契约不同），旧契约零调用方。
 */

import { ApiError, type AppServices, type SoeService } from './contracts'
import type { SoeSettingsConfig } from '@/lib/server-settings'
import { ApiSoeService } from './api/soe'
import { MockSoeService, type MockSoeOptions } from './mock/soe'
import { MockMnemonicService, type MockMnemonicOptions } from './mock/mnemonic'

/** 服务聚合（soe 演示伪评分 + mnemonic BFF 转发） */
export interface MockServices extends AppServices {}

export interface MockServicesOptions {
  soe?: MockSoeOptions
  mnemonic?: MockMnemonicOptions
}

export function getMockServices(options: MockServicesOptions = {}): MockServices {
  return {
    soe: new MockSoeService(options.soe),
    mnemonic: new MockMnemonicService(options.mnemonic),
  }
}

/** 统一入口：完整 AppServices（页面级单例，如 mnemonic 页的 services） */
export function getServices(): AppServices {
  return getMockServices()
}

/** 缓存的评分服务：read-aloud 每句评分都会解析，不必每次都 fetch + 服务端重读 settings.json */
let soeServiceCache: SoeService | null = null

/**
 * 跨标签页失效广播：soeServiceCache 是模块级缓存，保存设置的 tab 调
 * invalidateSoeServiceCache() 清不了其他 tab 的副本 —— 其他 tab 会在整个会话里
 * 继续用旧 provider 评分（含旧 mock）。保存后广播，各 tab 各清自己的缓存。
 * （直接手改 settings.json 的场景仍覆盖不到，刷新页面即恢复一致。）
 */
const SOE_CACHE_INVALIDATE_CHANNEL = 'ping-eng:soe-cache-invalidate'
if (typeof BroadcastChannel !== 'undefined') {
  const channel = new BroadcastChannel(SOE_CACHE_INVALIDATE_CHANNEL)
  channel.onmessage = () => { soeServiceCache = null }
}

/** SOE 设置已变更（设置页保存成功后调用）：使缓存的评分服务失效并广播到其他标签页 */
export function invalidateSoeServiceCache(): void {
  soeServiceCache = null
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      new BroadcastChannel(SOE_CACHE_INVALIDATE_CHANNEL).postMessage(Date.now())
    } catch { /* 广播失败不影响本 tab 失效 */ }
  }
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
    // 拉取失败（settings.json 损坏、dev 抖动）≠ 未配置：绝不能回落 mock 伪评分——
    // 与发音无关的伪分会写进 train: 训练记录，用户以为在真评分（2026-11 全仓复审）。
    // 显式抛错，由调用方（read-aloud）走既有错误 UI 提示；未配置的真实情形不会走到
    // 这里 —— GET /api/settings/soe 对缺失配置返回 200 + 默认 mock 配置。
    throw new ApiError('SOE_SETTINGS_UNAVAILABLE', '评分服务设置读取失败，本次不做评分（不会用伪分顶替），请检查服务状态后重试')
  }
  soeServiceCache = cfg.provider === 'mock' ? getMockServices().soe : new ApiSoeService()
  return soeServiceCache
}

/** 契约类型再导出，供上层（stores/页面）统一从 services 入口引用 */
export type {
  AppServices,
  SoeService,
  MnemonicService,
} from './contracts'
export { ApiError, toApiError, throwIfAborted, abortableDelay } from './contracts'
export type { ApiErrorPayload, SoeEvalMode } from './contracts'
