/**
 * 科大讯飞 WS 鉴权 URL —— hmac-sha256 签名。
 * 真源：xfyun.cn「语音评测（ISE）流式版」接口鉴权文档（查询于 2026-10）。
 *
 * 规范要点（偏离任意一条服务端都会重算失败 → 401）：
 *   1. 签名 = Base64(HMAC-SHA256(signatureOrigin, apiSecret))，不是 hex；
 *   2. 签名原文的请求行是 `GET {path} HTTP/1.1`（带协议版本）；
 *   3. query 的 authorization = encodeURIComponent(Base64(authorizationOrigin))，
 *      先 Base64 再整体 URL 编码，不是对原始串做 percent-encode。
 *
 * date 由调用方传入（new Date().toUTCString()，每次 attempt 新生成 —— 签名有效期约 5 分钟）。
 */

import { createHmac } from 'node:crypto'

export interface IflytekAuthInput {
  apiKey: string
  apiSecret: string
  host: string
  path: string
  /** RFC 1123 UTC 串，如 'Tue, 14 Nov 2023 12:00:00 GMT' */
  date: string
}

export interface IflytekAuthResult {
  /** 原始 authorization（未 Base64、未 URL 编码） */
  authorizationOrigin: string
  /** Base64 签名 */
  signature: string
  /** 已带编码 query 的完整 wss URL */
  url: string
}

export function buildIflytekWsUrl({ apiKey, apiSecret, host, path, date }: IflytekAuthInput): IflytekAuthResult {
  // 三行签名原文：host / date / 请求行（带 HTTP/1.1）
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin, 'utf-8').toString('base64')
  const url = `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${host}`
  return { authorizationOrigin, signature, url }
}
