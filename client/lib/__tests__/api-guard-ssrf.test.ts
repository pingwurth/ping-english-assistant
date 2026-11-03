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

  it('拒绝链路本地 IPv6（fe80::）与全零地址', () => {
    expect(isUnsafeUpstreamUrl('http://[fe80::1]:11434/v1')).toBe(true)
    expect(isUnsafeUpstreamUrl('http://[::]:8000')).toBe(true)
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
