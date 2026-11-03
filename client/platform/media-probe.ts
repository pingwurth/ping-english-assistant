/**
 * 媒体时长探测 —— 唯一实现（import 页时长回填与转写上传共用）。
 * loadedmetadata 读真实时长；失败/超时返回 null，不阻断调用方流程。
 */

/** 探测超时：moov box 尾置的 MP4 在慢盘上 metadata 可能很久，超时回落 null（调用方按未知时长处理） */
const PROBE_TIMEOUT_MS = 10_000

export function probeMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof URL === 'undefined' || typeof document === 'undefined') return resolve(null)
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio')
    let settled = false
    const finish = (d: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(d)
    }
    const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      finish(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null)
    }
    el.onerror = () => finish(null)
    el.src = url
  })
}
