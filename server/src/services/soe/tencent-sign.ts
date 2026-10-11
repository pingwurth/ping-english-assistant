/**
 * 腾讯云 TC3-HMAC-SHA256 请求签名 —— 零依赖实现（node:crypto），供 tencent.provider 使用。
 * 算法真源：cloud.tencent.com/document/api/213/30654（查询于 2026-10）。
 * 派生密钥链：secretKey → HMAC(日期) → HMAC(服务) → HMAC('tc3_request') → HMAC(stringToSign)。
 * 中间产物全部导出，测试可逐段做黄金向量钉死。
 */

import { createHash, createHmac } from 'node:crypto'

export interface Tc3SignInput {
  secretId: string
  secretKey: string
  /** 产品服务名，如 'soe' */
  service: string
  host: string
  action: string
  /** 参与 SHA256 的请求体 —— 必须与实际发送的 JSON.stringify 产物是同一字符串 */
  payload: string
  /** Unix 秒 */
  timestamp: number
}

export interface Tc3SignResult {
  authorization: string
  /** 签名用日期（UTC，yyyy-MM-dd） */
  date: string
  canonicalRequest: string
  stringToSign: string
  signature: string
}

const sha256hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
const hmacSha256 = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()

export function tc3HmacSha256Sign({ secretId, secretKey, service, host, action, payload, timestamp }: Tc3SignInput): Tc3SignResult {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  // 注意 canonicalHeaders 自身以 \n 结尾，其后还要再接一个 \n（双重换行是 TC3 经典坑）
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256hex(payload)}`
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256hex(canonicalRequest)}`

  const kDate = hmacSha256('TC3' + secretKey, date)
  const kService = hmacSha256(kDate, service)
  const kSigning = hmacSha256(kService, 'tc3_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { authorization, date, canonicalRequest, stringToSign, signature }
}
