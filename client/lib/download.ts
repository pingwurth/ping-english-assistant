/**
 * 浏览器下载助手 —— 全应用唯一的 downloadBlob 实现。
 *
 * 历史上有四份拷贝（其中两份参数顺序相反、一份同步 revoke 在 Safari 上会截断大文件下载），
 * 收敛于此：createObjectURL + click + 延迟 revoke。
 * 签名 (filename, blob) 与 DOM 语义（a.download = filename）一致。
 */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 不能在 click 同 tick revoke：Safari/Firefox 对大 blob（数百 MB 完整备份）
  // 的下载是异步取流的，立即 revoke 会取消/截断下载；延迟释放（Chrome 在 click
  // 时已快照，只是稍晚释放而已）
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
