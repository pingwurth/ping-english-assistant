/**
 * 笔记图片入库前压缩 —— platform 层实现（依赖 createImageBitmap/canvas，node 不可用，
 * 单测环境自动原样透传）。策略：
 *  - SVG / GIF 原样保留（矢量与动图经 canvas 重编码会丢信息，且通常本就不大）；
 *  - ≤ KEEP_AS_IS_BYTES 原样保留（小图重编码得不偿失）；
 *  - 其余：解码 → 长边缩到 ≤ MAX_EDGE → WebP(q0.85) 重编码（截图体积通常降一个量级，
 *    WebP 不支持时回落 JPEG，再失败原样入库）。
 * 错误面向用户可直接展示（调用方在笔记工具条内提示）。
 */

/** 入库体积上限：超过直接拒绝（防单张巨图拖垮 IDB 配额） */
export const NOTE_IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** 小图阈值：不重编码直接存 */
const KEEP_AS_IS_BYTES = 300 * 1024
/** 压缩后长边上限（px） */
const MAX_EDGE = 1280
const QUALITY = 0.85

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, QUALITY))
}

/** 压缩笔记图片；过大/解码失败抛用户可读错误 */
export async function compressImage(file: Blob): Promise<Blob> {
  if (file.size > NOTE_IMAGE_MAX_BYTES) throw new Error(`图片过大（超过 ${Math.round(NOTE_IMAGE_MAX_BYTES / 1048576)}MB），请先缩小再插入`)
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  if (file.size <= KEEP_AS_IS_BYTES) return file
  if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('图片解码失败，无法插入（格式不受支持？）')
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    const webp = await toBlob(canvas, 'image/webp')
    const out = webp ?? await toBlob(canvas, 'image/jpeg')
    // 压不动（如已是高密度小图）就存原文件
    return out && out.size < file.size ? out : file
  } finally {
    bitmap.close()
  }
}
