/**
 * 通用展示格式化 —— 唯一实现（各页面共用，防逐页拷贝漂移）。
 */

/** 字节体积：B / KB / MB 三档，KB 向上取整（不足 1KB 显示 1 KB） */
export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${n} B`
}
