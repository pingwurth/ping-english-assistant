import { describe, expect, it } from 'vitest'
import { buildTencentSoeWsUrl } from '../tencent-ws-auth'

/**
 * 黄金向量：期望值由独立 node:crypto 脚本（与模块不同代码路径）预计算后硬编码。
 * 输入：appId '1250000000' / secretId 'AKIDtest123' / secretKey 'testSecret456' /
 *       refText 'hello world' / now 1700000000（expired = +300 = 1700000300）/
 *       nonce '123456789' / voiceId 'abc123def456ghi789'（18 位）
 */
const INPUT = {
  appId: '1250000000',
  secretId: 'AKIDtest123',
  secretKey: 'testSecret456',
  refText: 'hello world',
  now: 1700000000,
  nonce: '123456789',
  voiceId: 'abc123def456ghi789',
}

/** 键字典序排序、值【不】URL 编码（ref_text 保留裸空格 —— 签名串与最终 URL 编码口径不同） */
const EXPECTED_SIGNATURE_ORIGIN =
  'soe.cloud.tencent.com/soe/api/1250000000?eval_mode=1&expired=1700000300&nonce=123456789&rec_mode=1&' +
  'ref_text=hello world&score_coeff=1.0&secretid=AKIDtest123&sentence_info_enabled=0&server_engine_type=16k_en&' +
  'text_mode=0&timestamp=1700000000&voice_format=1&voice_id=abc123def456ghi789'

const EXPECTED_SIGNATURE = 'LKHw3ldB49lJYWTxUiTZZCNpqWg='

const EXPECTED_URL =
  'wss://soe.cloud.tencent.com/soe/api/1250000000?eval_mode=1&expired=1700000300&nonce=123456789&rec_mode=1&' +
  'ref_text=hello%20world&score_coeff=1.0&secretid=AKIDtest123&sentence_info_enabled=0&server_engine_type=16k_en&' +
  'text_mode=0&timestamp=1700000000&voice_format=1&voice_id=abc123def456ghi789&' +
  'signature=LKHw3ldB49lJYWTxUiTZZCNpqWg%3D'

/** 第二组黄金向量：ref_text 含 '+' '/'，签名 Base64 同时含 '+' '/' '='（钉死编码器行为） */
const INPUT_SPECIAL = {
  appId: '1250000000',
  secretId: 'AKIDtest123',
  secretKey: 'testSecret456',
  refText: 'hello+world/special',
  now: 1700000000,
  nonce: '100000000',
  voiceId: 'vidxxxxxxxxxxxxxx0',
}
const EXPECTED_SIGNATURE_SPECIAL = 'B4bUC/N8qoZ+DylZdcBM1WS/S5k='

describe('buildTencentSoeWsUrl', () => {
  it('signatureOrigin 逐字符精确匹配（键字典序、值不 URL 编码）', () => {
    expect(buildTencentSoeWsUrl(INPUT).signatureOrigin).toBe(EXPECTED_SIGNATURE_ORIGIN)
  })

  it('signature 为 HMAC-SHA1+Base64 黄金向量', () => {
    const r = buildTencentSoeWsUrl(INPUT)
    expect(r.signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(r.signature).toBe(EXPECTED_SIGNATURE)
  })

  it('最终 URL 精确匹配：字符串值编码（ref_text 空格 → %20）、签名尾部 = → %3D', () => {
    expect(buildTencentSoeWsUrl(INPUT).url).toBe(EXPECTED_URL)
  })

  it('URL query 解码后可还原 signature 与 ref_text', () => {
    const r = buildTencentSoeWsUrl(INPUT)
    const query = new URL(r.url).searchParams
    expect(query.get('signature')).toBe(r.signature)
    expect(query.get('ref_text')).toBe(INPUT.refText)
  })

  it('含 + / = 的签名与 ref_text 均被 percent-encoded（裸 + / 不出现在 query）', () => {
    const r = buildTencentSoeWsUrl(INPUT_SPECIAL)
    expect(r.signature).toBe(EXPECTED_SIGNATURE_SPECIAL)
    const rawQuery = r.url.slice(r.url.indexOf('?'))
    expect(rawQuery).toContain(`signature=${encodeURIComponent(EXPECTED_SIGNATURE_SPECIAL)}`)
    expect(rawQuery).toContain('ref_text=hello%2Bworld%2Fspecial')
    // 裸 '+' 在 query 中会被服务端解析为空格，绝不能出现
    expect(rawQuery).not.toContain('+')
  })

  it('确定性：同注入输入两次调用结果一致', () => {
    expect(buildTencentSoeWsUrl(INPUT)).toEqual(buildTencentSoeWsUrl(INPUT))
  })

  it('未注入时：voice_id 为 18 位字母数字，两次调用 URL 不同（nonce/voice_id 随机）', () => {
    const base = { appId: '1250000000', secretId: 'AKIDtest123', secretKey: 'testSecret456', refText: 'hello' }
    const a = buildTencentSoeWsUrl(base)
    const b = buildTencentSoeWsUrl(base)
    const vid = new URL(a.url).searchParams.get('voice_id') ?? ''
    expect(vid).toMatch(/^[A-Za-z0-9]{18}$/)
    expect(a.url).not.toBe(b.url)
  })
})
