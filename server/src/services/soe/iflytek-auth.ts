/**
 * 科大讯飞 WS 鉴权 URL —— hmac-sha256 签名。
 * 真源：xfyun.cn「语音评测（ISE）流式版」接口鉴权文档（查询于 2026-10）。
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
  /** 原始 authorization（未 URL 编码） */
  authorizationOrigin: string
  /** 小写 hex 签名 */
  signature: string
  /** 已带编码 query 的完整 wss URL */
  url: string
}

export function buildIflytekWsUrl({ apiKey, apiSecret, host, path, date }: IflytekAuthInput): IflytekAuthResult {
  // 三行签名原文：host / date / 请求行
  const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path}`
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('hex')
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  const url = `wss://${host}${path}?authorization=${encodeURIComponent(authorizationOrigin)}&date=${encodeURIComponent(date)}&host=${host}`
  return { authorizationOrigin, signature, url }
}
