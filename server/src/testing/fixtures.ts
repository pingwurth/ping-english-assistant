/**
 * 测试夹具：zod 默认 env 合成 + 手工构建的 16k mono WAV（供 soe 服务与路由测试复用）。
 */

import { envSchema, type Env } from '../config/env'

/** zod 默认值 + 覆盖项 → Env（不读 process.env，保证测试确定性） */
export const mkEnv = (partial: Partial<Env> = {}): Env => ({ ...envSchema.parse({}), ...partial })

/** 手工构建 44 字节标准头 WAV（PCM=1 / 单声道 / 16000Hz / 32000 byte-rate / 2 block-align / 16bit） */
export function buildWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'latin1')
  header.write('fmt ', 12, 'latin1')
  header.writeUInt32LE(16, 16) // fmt chunk 尺寸
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 单声道
  header.writeUInt32LE(16000, 24) // 采样率
  header.writeUInt32LE(32000, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // 位深
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

/** 非全零测试 PCM（64 字节） */
export const TEST_PCM = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff))
