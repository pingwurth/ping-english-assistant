/**
 * 剪贴板写入。
 *
 * 优先用 Clipboard API；局域网 http 访问 H5（非安全上下文）下该 API 不可用，
 * 回退到临时 textarea + execCommand，保证移动端调试时复制按钮仍可用。
 *
 * @returns 是否复制成功（失败由调用方决定是否提示）
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限被拒或非安全上下文：继续走回退方案
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}