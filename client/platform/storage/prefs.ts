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
