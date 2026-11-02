/**
 * localStorage 设置项封装 —— 真源：docs/系统架构设计.md §4.2（设置项走 localStorage，小数据）
 * SSR 安全：仅在浏览器环境访问；JSON 序列化失败或隐私模式被拒时静默降级，不崩溃。
 */

const PREFIX = 'ping-english:'

export function getPref<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch { return fallback }
}

export function setPref<T>(key: string, value: T): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch { return false }
}

export function removePref(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(PREFIX + key)
  } catch { /* ignore */ }
}

/** 导出全部设置项（去前缀的 key → 已解析值），供备份用；损坏项跳过 */
export function exportAllPrefs(): Record<string, unknown> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const out: Record<string, unknown> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try { out[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k) ?? '') } catch { /* 跳过损坏项 */ }
    }
    return out
  } catch { return {} }
}

/** 该设置项是否已有本地值（备份导入时的冲突判断用） */
export function hasPref(key: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(PREFIX + key) != null
  } catch { return false }
}

/**
 * 备份导入专用：先写入一组 prefs，并返回失败时可用的恢复句柄。
 * localStorage 不能参与 IndexedDB 事务；备份层在 IDB 写入失败时调用 rollback()。
 */
export interface StagedPrefs {
  written: number
  skipped: number
  rollback: () => void
}

export function stagePrefs(
  prefs: Record<string, unknown>,
  skipExisting: boolean,
): StagedPrefs {
  if (typeof localStorage === 'undefined') {
    return { written: 0, skipped: Object.keys(prefs).length, rollback: () => {} }
  }

  const touched: Array<{ key: string; previous: string | null }> = []
  let written = 0
  let skipped = 0
  try {
    for (const [key, value] of Object.entries(prefs)) {
      const storageKey = PREFIX + key
      if (skipExisting && localStorage.getItem(storageKey) != null) {
        skipped++
        continue
      }
      const previous = localStorage.getItem(storageKey)
      if (!setPref(key, value)) throw new Error(`无法写入设置项：${key}`)
      touched.push({ key, previous })
      written++
    }
  } catch (err) {
    rollbackTouchedPrefs(touched)
    throw err
  }

  return {
    written,
    skipped,
    rollback: () => rollbackTouchedPrefs(touched),
  }
}

function rollbackTouchedPrefs(touched: Array<{ key: string; previous: string | null }>): void {
  for (const item of touched.reverse()) {
    try {
      if (item.previous === null) localStorage.removeItem(PREFIX + item.key)
      else localStorage.setItem(PREFIX + item.key, item.previous)
    } catch { /* 尽力恢复；调用方保留原错误以让导入失败可见 */ }
  }
}
