import { describe, expect, it } from 'vitest'
import { buildIflytekWsUrl } from '../iflytek-auth'

/** 黄金向量：签名由独立 node:crypto 脚本（与模块不同代码路径）预计算后硬编码 */
const INPUT = {
  apiKey: 'abc123key',
  apiSecret: 'xyz789secret',
  host: 'ise-api.xfyun.cn',
  path: '/v2/open-ise',
  date: 'Tue, 14 Nov 2023 12:00:00 GMT',
}

const EXPECTED_SIGNATURE = 'bfe5f5ac01cf766e8af0c5654ee9431d1309a9be6d3f18ca38361eb3ac1acbf6'

describe('buildIflytekWsUrl', () => {
  it('signature 为 64 位 hex 且精确匹配黄金向量', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(r.signature).toBe(EXPECTED_SIGNATURE)
  })

  it('authorizationOrigin 精确模板串', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.authorizationOrigin).toBe(
      `api_key="abc123key", algorithm="hmac-sha256", headers="host date request-line", signature="${EXPECTED_SIGNATURE}"`,
    )
  })

  it('url 以 wss://host/path? 开头，authorization/date 参数可解码还原', () => {
    const r = buildIflytekWsUrl(INPUT)
    expect(r.url.startsWith('wss://ise-api.xfyun.cn/v2/open-ise?')).toBe(true)
    const query = new URL(r.url).searchParams
    expect(decodeURIComponent(query.get('authorization') ?? '')).toBe(r.authorizationOrigin)
    expect(decodeURIComponent(query.get('date') ?? '')).toBe(INPUT.date)
    expect(query.get('host')).toBe(INPUT.host)
  })

  it('authorization 参数确实被 percent-encoded（原始 query 含 %22，不含裸引号）', () => {
    const r = buildIflytekWsUrl(INPUT)
    const rawQuery = r.url.slice(r.url.indexOf('?'))
    expect(rawQuery).toContain('authorization=api_key%3D%22')
    expect(rawQuery).not.toContain('"')
  })
})
