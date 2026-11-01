/**
 * parseHfPath 单测 —— 恶意 segment 矩阵。
 * 解析结果直接喂 join(modelPath, cacheKey, file) 的磁盘读写（hf 代理路由），
 * 任何放过的 '..' / 编码斜杠段都是路径穿越（任意本地文件读 + 任意路径写）。
 * Next 路由会先把 %2e%2e/%2f 解码进段，故按「解码后形态」构造用例。
 */
import { describe, expect, it } from 'vitest'
import { parseHfPath } from '../hf-path'

const BASE = 'https://huggingface.co'
// Next 按 / 切段：onnx/model_q8.onnx 到达时是两个独立段
const OK = ['onnx-community', 'Kokoro-82M-v1.0-ONNX', 'resolve', 'main', 'onnx', 'model_q8.onnx']

describe('parseHfPath 合法路径', () => {
  it('标准 Kokoro 模型文件：拆出 modelId/cacheKey/file 与上游 URL', () => {
    const ref = parseHfPath(OK, BASE)
    expect(ref).toEqual({
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      cacheKey: 'onnx-community--Kokoro-82M-v1.0-ONNX',
      file: 'onnx/model_q8.onnx',
      url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8.onnx',
    })
  })

  it('多段 repo 与嵌套 file 路径可用（段本身干净即无穿越风险）', () => {
    const ref = parseHfPath(['org', 'sub', 'repo', 'resolve', 'main', 'a', 'b', 'c.bin'], BASE)
    expect(ref?.modelId).toBe('org/sub/repo')
    expect(ref?.file).toBe('a/b/c.bin')
  })
})

describe('parseHfPath 恶意 segment 矩阵（一律 null）', () => {
  const cases: Array<[string, string[]]> = [
    ['段为 ..（穿越）', ['..', 'repo', 'resolve', 'main', 'f']],
    ['段为 .（当前目录）', ['.', 'repo', 'resolve', 'main', 'f']],
    ['file 段为 ..', ['org', 'repo', 'resolve', 'main', '..']],
    ['file 深处的 ..', ['org', 'repo', 'resolve', 'main', 'a', '..', 'passwd']],
    ['段内嵌斜杠（解码 %2F 后的合并段）', ['org/..', 'repo', 'resolve', 'main', 'f']],
    ['段内嵌反斜杠（Windows 分隔）', ['org', 'repo', 'resolve', 'main', 'f\\g']],
    [' UNC 风格段', ['..\\\\server\\\\share', 'repo', 'resolve', 'main', 'f']],
    ['空段', ['', 'repo', 'resolve', 'main', 'f']],
    ['缺 resolve 关键字', ['org', 'repo', 'main', 'f']],
    ['resolve 出现在 org 位置', ['resolve', 'main', 'f']],
    ['resolve 出现在 repo 位置', ['org', 'resolve', 'main', 'f']],
    ['无 file 段', ['org', 'repo', 'resolve', 'main']],
    ['revision 为空串', ['org', 'repo', 'resolve', '', 'f']],
    ['非 main revision（白名单外）', ['org', 'repo', 'resolve', 'v2', 'f']],
  ]
  for (const [name, path] of cases) {
    it(name, () => {
      expect(parseHfPath(path, BASE)).toBeNull()
    })
  }
})
