/**
 * WAV 头剥离：从 data chunk 取出纯 PCM 载荷（讯飞 aue=raw 需要）。
 * 腾讯 VoiceFileType=2 / Azure 均收 WAV 原样，不走此函数。
 * 零依赖实现：手动走 RIFF chunk 链，data 之前可能夹有 fmt/LIST 等任意 chunk。
 */

/**
 * 剥离 WAV 头，返回 data chunk 的 PCM 载荷（subarray 视图，不拷贝）。
 * 非 RIFF/WAVE 或找不到 data chunk 时原样返回输入（裸 PCM 兜底，交由上游报错）。
 */
export function stripWavHeader(audio: Buffer): Buffer {
  if (audio.length < 12) return audio
  if (audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') return audio
  let off = 12
  while (off + 8 <= audio.length) {
    const id = audio.toString('latin1', off, off + 4)
    const size = audio.readUInt32LE(off + 4)
    if (id === 'data') return audio.subarray(off + 8, off + 8 + size)
    // RIFF 规范：奇数尺寸 chunk 后补 1 字节再接下一个 chunk
    off += 8 + size + (size & 1)
  }
  return audio
}
