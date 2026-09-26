/**
 * 翻译模型配置 Hook —— 供单句翻译（字幕编辑弹窗）与整篇翻译（抽屉）共用。
 *
 * - 仅在首次启用时请求 /api/settings/llm-configs，之后复用（弹窗反复开关不重复请求）
 * - 只保留配置了 translateModel 的条目；默认选中 defaultId 对应项，否则取第一项
 * - 请求失败时不置已加载标记，下次启用会重试
 */

import { useEffect, useRef, useState } from 'react'

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
  const [configs, setConfigs] = useState<TranslateConfig[]>([])
  const [configId, setConfigId] = useState('')
  /** 已成功加载过：避免弹窗反复开关时重复请求 */
  const loadedRef = useRef(false)

  useEffect(() => {
    if (!enabled || loadedRef.current) return
    loadedRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/settings/llm-configs')
        const data = await res.json()
        if (cancelled) return
        const list: TranslateConfig[] = (data.configs || [])
          .filter((c: { translateModel?: string }) => c.translateModel)
          .map((c: TranslateConfig) => ({ id: c.id, name: c.name, translateModel: c.translateModel }))
        setConfigs(list)
        if (list.length > 0) {
          const defaultCfg = list.find((c) => c.id === data.defaultId) || list[0]
          setConfigId(defaultCfg.id)
        }
      } catch {
        // 读取失败：允许下次启用时重试
        loadedRef.current = false
      }
    })()
    return () => { cancelled = true }
  }, [enabled])

  return { configs, configId, setConfigId }
}