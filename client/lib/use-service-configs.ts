/**
 * LLM 服务配置拉取 Hook —— 唯一实现（原三处拷贝的错误/重试语义已各自漂移：
 * 单句翻译弹窗失败可重试、转写页失败返回空列表、TTS 页失败回落 kokoro）。
 *
 * - 同屏多字段共用一次请求（模块级缓存；失败清缓存允许下次重试）
 * - 仅启用（enabled）时请求，成功后复用；force 可强制重取（「刷新配置」用）
 * - 过滤 + 默认选择统一走 selectServiceConfigs（同一默认策略）
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { selectServiceConfigs, type LlmConfigsResponse } from '@/lib/llm-configs'

/** /api/settings/llm-configs 响应的模块级缓存：TTS/转写等页面同屏需要多字段时只发一次请求 */
let llmConfigsRequest: Promise<LlmConfigsResponse> | null = null

/** 拉取 LLM 配置（带模块级去重缓存）；force=true 丢弃缓存重新请求 */
export function fetchLlmConfigs(force = false): Promise<LlmConfigsResponse> {
  // force 必须先丢弃已 resolve 的缓存 promise 再发请求 —— 缓存只在失败时清，
  // 成功后 ??= 永远短路，force 会拿到同一份旧响应（「保存配置又弹框」死循环的根因）
  if (force) llmConfigsRequest = null
  llmConfigsRequest ??= fetch('/api/settings/llm-configs')
    .then((r) => r.json() as Promise<LlmConfigsResponse>)
    .catch((err) => {
      llmConfigsRequest = null // 失败清缓存：下次启用/挂载重试
      throw err
    })
  return llmConfigsRequest
}

/**
 * 已挂载 hook 的失效回调登记表：invalidateLlmConfigsCache 时逐个触发 force 重取。
 * 只清模块缓存救不了**已挂载**的 hook——它们被 loadedRef 短路,页面上的兄弟字段
 * （如转写页的翻译下拉）要等整页重挂才能看到新配置（quick 复审 c016）。
 */
const mountedReloads = new Set<() => void>()

/**
 * LLM 配置已变更（设置页保存/删除成功后调用）：清模块级缓存，并通知所有已挂载
 * 的 useServiceConfigs 立即 force 重取（同页兄弟字段一并刷新）。
 * 与 services 的 invalidateSoeServiceCache 对称。
 */
export function invalidateLlmConfigsCache(): void {
  llmConfigsRequest = null
  for (const reload of [...mountedReloads]) reload()
}

export type ServiceConfigsStatus = 'loading' | 'ready' | 'error'

export interface ServiceConfigsState<T> {
  configs: T[]
  configId: string
  setConfigId: (id: string) => void
  /** 默认配置 id（defaultId 命中字段者，否则首项；无配置为 ''） */
  preferredId: string
  /** ready/error 各终态一次；调用方据此做回落（如 TTS 页失败回落 kokoro） */
  status: ServiceConfigsStatus
  /** 立即拉取并应用，返回当前列表（已加载时短路返回缓存列表；force=true 强制重取） */
  load: (force?: boolean) => Promise<T[]>
}

/**
 * 拉取配置了指定服务字段（asrModel / ttsModel / translateModel / …）的模型配置。
 * @param enabled 是否启用（弹窗/抽屉打开时才请求）；常驻页面传 true
 * @param field   服务字段名
 * @param pick    从原始配置对象挑选/塑形调用方需要的条目结构
 */
export function useServiceConfigs<T extends { id: string }>(
  enabled: boolean,
  field: string,
  pick: (raw: { id: string } & Record<string, unknown>) => T,
): ServiceConfigsState<T> {
  const [configs, setConfigs] = useState<T[]>([])
  const [configId, setConfigId] = useState('')
  const [preferredId, setPreferredId] = useState('')
  const [status, setStatus] = useState<ServiceConfigsStatus>('loading')
  /** 已成功加载过：默认短路，避免弹窗反复开关/重复挂载时重复请求 */
  const loadedRef = useRef(false)
  const configsRef = useRef(configs)
  configsRef.current = configs
  const pickRef = useRef(pick)
  pickRef.current = pick

  const load = useCallback(async (force = false): Promise<T[]> => {
    if (!force && loadedRef.current) return configsRef.current
    loadedRef.current = true
    try {
      const data = await fetchLlmConfigs(force)
      const selected = selectServiceConfigs<{ id: string } & Record<string, unknown>>(data, field)
      const list = selected.list.map((c) => pickRef.current(c))
      setConfigs(list)
      setPreferredId(selected.preferredId ?? '')
      if (selected.preferredId) {
        // 刷新不得覆盖用户新近手选：当前选择仍在新列表中就保留，
        // 仅在尚未选择或所选已被删除时回落 preferredId
        setConfigId((prev) =>
          prev && selected.list.some((c) => c.id === prev) ? prev : (selected.preferredId ?? ''),
        )
      }
      setStatus('ready')
      return list
    } catch {
      // 读取失败：复位标记，下次启用/调用重试
      loadedRef.current = false
      setStatus('error')
      return []
    }
  }, [field])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  // 失效广播的接收端：配置保存/删除后（invalidateLlmConfigsCache）立即重取,
  // loadedRef 短路不再挡住本 hook；force 语义会保留仍有效的用户手选（见 load）。
  // 未启用（弹窗/抽屉未开）的 hook 不跟着发请求——启用时本就有首次加载
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled
  useEffect(() => {
    const reload = (): void => { if (enabledRef.current) void load(true) }
    mountedReloads.add(reload)
    return () => { mountedReloads.delete(reload) }
  }, [load])

  return { configs, configId, setConfigId, preferredId, status, load }
}
