/**
 * /api/settings/llm-configs 响应的「按服务字段过滤 + 默认选择」共享逻辑。
 *
 * 此前三个调用方（transcribe-shared / use-translate-configs / tts 页）各持一份
 * 全模式拷贝，缓存与默认选择策略各行其是 —— 为同一用户选出不同模型的事由此消除。
 */

export interface LlmConfigsResponse {
  configs?: unknown
  defaultId?: string | null
}

/**
 * 过滤出配置了指定服务字段（asrModel / ttsModel / translateModel / mnemonicModel）的条目，
 * 并按「defaultId 对应项优先，否则取第一项」选出默认。
 * T 只要求带 id（具体配置形状由调用方定义）。
 */
export function selectServiceConfigs<T extends { id: string }>(
  data: LlmConfigsResponse,
  field: string,
): { list: T[]; preferredId: string | null } {
  const all = Array.isArray(data.configs) ? (data.configs as T[]) : []
  const list = all.filter((c) => !!(c as unknown as Record<string, unknown>)[field])
  const preferred = list.find((c) => c.id === data.defaultId) ?? list[0]
  return { list, preferredId: preferred?.id ?? null }
}
