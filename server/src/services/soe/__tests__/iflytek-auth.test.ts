import { describe, expect, it } from 'vitest'
import { buildIflytekWsUrl } from '../iflytek-auth'

/**
 * 黄金向量：签名由独立 node:crypto 脚本（与模块不同代码路径）按官方鉴权规范预计算后硬编码。
 * 规范（xfyun WebAPI）：
 *   signatureOrigin = host/date/请求行（`GET {path} HTTP/1.1`）
 *   signature = Base64(HMAC-SHA256(signatureOrigin, apiSecret))
 *   authorization = Base64(authorizationOrigin)，再整体 URL 编码进 query
 */
const INPUT = {
  apiKey: 'abc123key',
  apiSecret: 'xyz789secret',
  host: 'ise-api.xfyun.cn',
  path: '/v2/open-ise',
  date: 'Tue, 14 Nov 2023 12:00:00 GMT',
}

const EXPECTED_SIGNATURE = 'stweATNDym9KJAE0ZZVEy3NeNcY5Tnn+Onsk95/xzw0='

const EXPECTED_AUTH_ORIGIN =
  `api_key="abc123key", algorithm="hmac-sha256", headers="host date request-line", signature="${EXPECTED_SIGNATURE}"`

const EXPECTED_AUTH_B64 =
  'YXBpX2tleT0iYWJjMTIza2V5IiwgYWxnb3JpdGhtPSJobWFjLXNoYTI1NiIsIGhlYWRlcnM9Imhvc3QgZGF0ZSByZXF1ZXN0LWxpbmUiLCBzaWduYXR1cmU9InN0d2VBVE5EeW05S0pBRTBaWlZFeTNOZU5jWTVUbm4rT25zazk1L3h6dzA9Ig=='

describe('buildIflytekWsUrl', () => {
  it('signature 为 Base64 且精确匹配黄金向量', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.signature).toBe(EXPECTED_SIGNATURE)
  })

  it('authorizationOrigin 精确模板串', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.authorizationOrigin).toBe(EXPECTED_AUTH_ORIGIN)
  })

  it('url 以 wss://host/path? 开头，date/host 参数可解码还原', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.url.startsWith('wss://ise-api.xfyun.cn/v2/open-ise?')).toBe(true)
    const query = new URL(r.url).searchParams
    expect(decodeURIComponent(query.get('date') ?? '')).toBe(INPUT.date)
    expect(query.get('host')).toBe(INPUT.host)
  })

  it('authorization 参数 = URL编码(Base64(authorizationOrigin))，而非原始串的 percent-encode', () => {
    const r = buildIflytekWsUrl(INPUT)
    // 不用 URLSearchParams：它会把 Base64 的 '+' 解成空格，这里对原始 query 手动解码
    const rawQuery = r.url.slice(r.url.indexOf('?'))
    const rawAuth = rawQuery.match(/authorization=([^&]*)/)?.[1] ?? ''
    expect(decodeURIComponent(rawAuth)).toBe(EXPECTED_AUTH_B64)
    // Base64 后整体编码：解码一次还原 Base64 串，再解一次才是 authorizationOrigin
    expect(atob(decodeURIComponent(rawAuth))).toBe(EXPECTED_AUTH_ORIGIN)
    // 原始 query 不含裸引号 / 裸 api_key=（那是未 Base64 的旧错误形态）
    expect(rawQuery).not.toContain('"')
    expect(rawQuery).not.toContain('api_key%3D')
  })
})
