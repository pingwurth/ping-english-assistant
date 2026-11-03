/**
 * WAV 头解析（全应用唯一实现）—— 评审 #22 收敛三份漂移拷贝。
 *
 * RIFF 校验 + chunk 遍历定位 data 块：fmt 与 data 之间可能夹 LIST/INFO 等
 * chunk，固定偏移 40 读「data 大小」会把别的 chunk 大小当 data（实测夹 26 字节
 * LIST 时 1000ms 音频算出 1ms）。
 * 非法 / 无法解析返回 null，由调用方决定回退策略。
 */

export function parseWavDurationMs(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 44) return null
  const dv = new DataView(buf)

  const tag = (off: number, len: number) =>
    String.fromCharCode(...new Uint8Array(buf, off, len))

  if (tag(0, 4) !== 'RIFF' || tag(8, 4) !== 'WAVE') return null

  // fmt 块按惯例紧跟文件头（12 字节起）；字段为固定布局
  const channels = dv.getUint16(22, true)
  const sampleRate = dv.getUint32(24, true)
  const blockAlign = dv.getUint16(32, true)
  if (!channels || !sampleRate || !blockAlign) return null

  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = tag(off, 4)
    const size = dv.getUint32(off + 4, true)
    if (id === 'data') {
      return Math.round((size / blockAlign / sampleRate) * 1000)
    }
    off += 8 + size + (size & 1) // chunk 按 2 字节对齐（奇数大小带 1 字节 padding）
  }
  return null
}

/** 解析失败（非 WAV / 异常头）时按给定字节率估算兜底，永不返回 0/负数 */
export function parseWavDurationWithFallback(buf: ArrayBuffer, fallbackBytesPerSecond: number): number {
  return parseWavDurationMs(buf) ?? Math.max(1, Math.round((buf.byteLength / fallbackBytesPerSecond) * 1000))
}

/**
 * TTS 上游 base64 音频 → { audioBuffer, durationMs }（mimo/dashscope 两 provider 共用）。
 * slice 出精确视图：小 payload（≤4KB）时 Node 从 8KB 池分配，直接取 .buffer 会把
 * 池内垃圾一起带给上层编码成坏 WAV —— 该 workaround 原先只在一份拷贝里修过，抽到
 * 唯一实现防再漂移。24kHz mono 16-bit = 48kB/s 为头解析失败时的字节率估算兜底。
 * 仅 BFF（Node）侧调用；浏览器侧勿用（依赖 Buffer）。
 */
export function decodeTtsAudioPayload(base64: string): { audioBuffer: ArrayBuffer; durationMs: number } {
  const buf = Buffer.from(base64, 'base64')
  const audioBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return { audioBuffer, durationMs: parseWavDurationWithFallback(audioBuffer, 24_000 * 2) }
}
