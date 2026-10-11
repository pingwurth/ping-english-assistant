import { describe, expect, it } from 'vitest'
import { tc3HmacSha256Sign } from '../tencent-sign'

/**
 * 黄金向量：期望值由独立 node:crypto 脚本（与模块不同代码路径）预计算后硬编码。
 * 输入：secretId 'AKIDtest123' / secretKey 'testSecret456' / service 'soe' /
 *       host 'soe.tencentcloudapi.com' / action 'TransmitOralProcessWithInit' /
 *       payload '{"RefText":"hello"}' / timestamp 1700000000（UTC 2023-11-14T22:13:20Z）
 */
const INPUT = {
  secretId: 'AKIDtest123',
  secretKey: 'testSecret456',
  service: 'soe',
  host: 'soe.tencentcloudapi.com',
  action: 'TransmitOralProcessWithInit',
  payload: '{"RefText":"hello"}',
  timestamp: 1700000000,
}

const EXPECTED_CANONICAL_REQUEST = [
  'POST',
  '/',
  '',
  'content-type:application/json; charset=utf-8',
  'host:soe.tencentcloudapi.com',
  'x-tc-action:transmitoralprocesswithinit',
  '', // canonicalHeaders 尾部 \n 之后再接一个 \n（双重换行是 TC3 经典坑）
  'content-type;host;x-tc-action',
  'ba940a18837a8065226660c11e6058ec61f6a75c99e82672cbe815b925d18237',
].join('\n')

const EXPECTED_STRING_TO_SIGN = [
  'TC3-HMAC-SHA256',
  '1700000000',
  '2023-11-14/soe/tc3_request',
  'ef47496419f901bafe568aa4b5b841af9a3e02c903cda8a661c9f6d3592bf247',
].join('\n')

const EXPECTED_SIGNATURE = 'abb672d3b7bccd161cf155a5130a83e38d70d7676b653ff4aa19641d5d86e40b'

const EXPECTED_AUTHORIZATION = [
  'TC3-HMAC-SHA256 Credential=AKIDtest123/2023-11-14/soe/tc3_request,',
  ' SignedHeaders=content-type;host;x-tc-action,',
  ` Signature=${EXPECTED_SIGNATURE}`,
].join('')

describe('tc3HmacSha256Sign', () => {
  it('canonicalRequest 逐段精确匹配（含双重换行）', () => {
    const r = tc3HmacSha256Sign(INPUT)
    expect(r.canonicalRequest).toBe(EXPECTED_CANONICAL_REQUEST)
    expect(r.date).toBe('2023-11-14')
  })

  it('stringToSign 逐段精确匹配', () => {
    expect(tc3HmacSha256Sign(INPUT).stringToSign).toBe(EXPECTED_STRING_TO_SIGN)
  })

  it('signature 为 64 位 hex 且精确匹配', () => {
    const r = tc3HmacSha256Sign(INPUT)
    expect(r.signature).toMatch(/^[0-9a-f]{64}$/)
    expect(r.signature).toBe(EXPECTED_SIGNATURE)
  })

  it('authorization 模板精确匹配', () => {
    expect(tc3HmacSha256Sign(INPUT).authorization).toBe(EXPECTED_AUTHORIZATION)
  })

  it('确定性：同输入两次调用结果一致', () => {
    expect(tc3HmacSha256Sign(INPUT)).toEqual(tc3HmacSha256Sign(INPUT))
  })
})
