/**
 * 上游 baseUrl SSRF 闸门回归（2026-11 全仓复审 #2）：
 * POST /api/models 的 baseUrl 完全由请求体控制，服务端直接 fetch ——
 * 链路本地/元数据地址与非 http(s) 协议必须拒绝；本机/局域网推理服务
 * 是本应用的核心场景（Ollama 等），必须放行。
 */
import { describe, expect, it } from 'vitest'
import { isUnsafeUpstreamUrl } from '../api-guard'

describe('isUnsafeUpstreamUrl', () => {
  it('拒绝云元数据与链路本地段（169.254.0.0/16）', () => {
    expect(isUnsafeUpstreamUrl('http://169.254.169.254/latest/meta-data/')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://169.254.10.20:11434/v1')).toBe(true)
  })

  it('拒绝链路本地 IPv6（fe80::/10 全段）与全零地址', () => {
    expect(isUnsafeUpstreamUrl('http://[fe80::1]:11434/v1')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[::]:8000')).toBe(true)
    // fe80::/10 覆盖 fe80–febf 首组；旧实现只拦字面 fe80 前缀（63/64 段放行）
    expect(isUnsafeUpstreamUrl('http://[fe8f::1]:11434/v1')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[fe90::1]:11434/v1')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[febf::1]:11434/v1')).toBe(true)
  })

  it('拒绝 IPv4-mapped / 兼容 / NAT64 形态内嵌的 169.254/16', () => {
    // WHATWG 把 [::ffff:169.254.169.254] 序列化成 '[::ffff:a9fe:a9fe]'，字符串前缀拦不住
    expect(isUnsafeUpstreamUrl('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[::ffff:a9fe:a9fe]/latest/meta-data')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[64:ff9b::a9fe:a9fe]/latest/meta-data/')).toBe(true)
  })

  it('拒绝未压缩完整 8 组拼写的链路本地地址', () => {
    // URL 会归一成 [fe80::1]，但解析器须独立正确处理 8 组形式
    expect(isUnsafeUpstreamUrl('http://[fe80:0:0:0:0:0:0:1]:11434/v1')).toBe(true)
  })

  it('放行正常 IPv6 公网/ULA 上游与映射的正常 IPv4', () => {
    expect(isUnsafeUpstreamUrl('http://[2001:db8::1]:8080/v1')).toBe(false)
    expect(isUnsafeUpstreamUrl('http://[fd00::114]:11434')).toBe(false)
    expect(isUnsafeUpstreamUrl('http://[::ffff:192.168.1.10]:11434/v1')).toBe(false)
  })

  it('拒绝非 http(s) 协议与不可解析输入', () => {
    expect(isUnsafeUpstreamUrl('file:///etc/passwd')).toBe(true)
    expect(isUnsafeUpstreamUrl('gopher://127.0.0.1:11211')).toBe(true)
    expect(isUnsafeUpstreamUrl('not a url')).toBe(true)
  })

  it('放行本机/局域网/公网推理服务（本地优先部署的核心场景）', () => {
    expect(isUnsafeUpstreamUrl('http://localhost:11434/v1')).toBe(false)
    expect(isUnsafeUpstreamUrl('http://192.168.110.23:8766')).toBe(false)
    expect(isUnsafeUpstreamUrl('http://127.0.0.1:1234/v1')).toBe(false)
    expect(isUnsafeUpstreamUrl('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(false)
  })
})
