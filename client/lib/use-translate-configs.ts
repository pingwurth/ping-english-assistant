/**
 * 翻译模型配置 Hook —— 供单句翻译（字幕编辑弹窗）与整篇翻译（抽屉）共用。
 * 拉取/缓存/默认选择统一委托 lib/use-service-configs（原三处拷贝的收敛）。
 */

import { useServiceConfigs } from '@/lib/use-service-configs'

/** 翻译配置项（仅翻译相关字段） */
export interface TranslateConfig {
  id: string
  name: string
  translateModel: string
}

/**
 * 加载翻译模型配置。
 * @param enabled 是否启用（弹窗/抽屉打开）——为 false 时不发请求
 * @returns configs 可用配置列表；configId 当前选中 id；setConfigId 切换选中
 */
export function useTranslateConfigs(enabled: boolean) {
  const { configs, configId, setConfigId } = useServiceConfigs<TranslateConfig>(enabled, 'translateModel', (c) => ({
    id: c.id,
    name: String(c.name ?? ''),
    translateModel: String(c.translateModel ?? ''),
  }))
  return { configs, configId, setConfigId }
}
