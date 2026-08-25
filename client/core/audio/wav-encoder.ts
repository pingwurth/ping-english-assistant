/**
 * WAV 编码器 —— 真源：docs/系统架构设计.md ADR-5（录音统一 WAV 16kHz 单声道 16bit）
 *
 * encodeWav(samples, sampleRate?)：Float32 PCM [-1, 1) → 标准 44 字节头 WAV Blob。
 * 纯函数、零浏览器特有 API（Node 18+ 全局 Blob 可测）、确定性输出。
 */

/** WAV 文件 MIME 类型（上传契约①②的 audio 文件格式） */
export const WAV_MIME = 'audio/wav'

/** ADR-5 约定的目标采样率（SOE + Whisper 均要求 16kHz） */
export const TARGET_SAMPLE_RATE = 16000

/**
 * 将 Float32 PCM 样本编码为 WAV Blob（16bit 单声道，标准 44 字节 RIFF 头）。
 * @param samples    PCM 样本（越界值自动 clamp 到 [-1, 1)）
 * @param sampleRate 采样率，默认 16000（ADR-5）
 */
export function encodeWav(samples: Float32Array, sampleRate: number = TARGET_SAMPLE_RATE): Blob {
  const dataSize = samples.length * 2 // 16bit = 2 Byte/sample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i++) view.setUint8(offset + i, tag.charCodeAt(i))
  }

  /* ── RIFF 头（44 字节，小端） ── */
  writeTag(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // ChunkSize = 36 + dataSize
  writeTag(8, 'WAVE')
  writeTag(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt 块大小（PCM）
  view.setUint16(20, 1, true) // AudioFormat = 1（PCM）
  view.setUint16(22, 1, true) // NumChannels = 1（单声道）
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // ByteRate = sampleRate × blockAlign
  view.setUint16(32, 2, true) // BlockAlign = channels × bitsPerSample/8
  view.setUint16(34, 16, true) // BitsPerSample = 16
  writeTag(36, 'data')
  view.setUint32(40, dataSize, true)

  /* ── PCM 数据（float [-1,1) → int16；四舍五入 + 显式 clamp 防溢出，NaN 归零） ── */
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const scaled = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
    const v = Number.isFinite(scaled) ? Math.max(-32768, Math.min(32767, scaled)) : 0
    view.setInt16(offset, v, true)
    offset += 2
  }

  return new Blob([buffer], { type: WAV_MIME })
}

/** 由 WAV 样本数计算时长（ms），供录音/评分链路上报 durationMs */
export function wavDurationMs(sampleCount: number, sampleRate: number = TARGET_SAMPLE_RATE): number {
  return Math.round((sampleCount / sampleRate) * 1000)
}
