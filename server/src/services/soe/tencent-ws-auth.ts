/**
 * 腾讯云「口语评测（新版/OEN）」WebSocket 鉴权 URL —— HMAC-SHA1 + Base64。
 * 真源：cloud.tencent.com/document/product/1774/107497（查询于 2026-10）；
 * 签名串构造对照官方 JS SDK（github.com/TencentCloud/tencentcloud-speech-sdk-js
 * soe/lib/credential.ts）逐行复刻：
 *   1. 除 signature 外的全部参数按键名字典序排序；
 *   2. 签名原文 = `soe.cloud.tencent.com/soe/api/<appid>?` + `k=v` 以 & 连接，
 *      值【不】做 URL 编码（SDK formatSignString(queryStr, false) 分支 —— 经典坑：
 *      签名串与最终 URL 的编码口径不同，签名串里混入编码值即 4002 鉴权失败）；
 *   3. signature = Base64(HMAC-SHA1(原文, SecretKey))；
 *   4. 最终 URL = `wss://` + 同一排序串但字符串值经 encodeURIComponent（SDK true 分支）
 *      + `&signature=` + encodeURIComponent(signature)（'+' '/' '=' 必须被编码）。
 * 中间产物全部导出，测试可做黄金向量钉死。
 */

import { createHmac, randomBytes, randomInt } from 'node:crypto'

const HOST = 'soe.cloud.tencent.com'
const PATH_PREFIX = '/soe/api/'
/** 签名有效期（秒）：官方 SDK 用 24h，这里取保守 5 分钟 */
const EXPIRES_IN_SEC = 300
const VOICE_ID_LEN = 18

export interface TencentSoeWsInput {
  /** 腾讯云账号 AppID（数字，嵌入 URL 路径并参与签名） */
  appId: string
  secretId: string
  secretKey: string
  /** 参考文本（传原文即可，模块内部负责编码） */
  refText: string
  /** 黄金向量测试注入口：Unix 秒（缺省取当前时间） */
  now?: number
  /** 黄金向量测试注入口：随机数（缺省随机生成 9 位数字串） */
  nonce?: string
  /** 黄金向量测试注入口：会话唯一 ID（缺省随机 18 位字母数字） */
  voiceId?: string
}

export interface TencentSoeWsResult {
  /** 可直接 new WebSocket(url) 的完整 wss 地址 */
  url: string
  /** 签名原文（值未 URL 编码） */
  signatureOrigin: string
  /** Base64(HMAC-SHA1(signatureOrigin, secretKey))，未 URL 编码 */
  signature: string
}

/** 随机 18 位字母数字 voice_id（口径参照官方 SDK 的 guid()） */
function randomVoiceId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(VOICE_ID_LEN)
  let out = ''
  for (let i = 0; i < VOICE_ID_LEN; i++) out += chars[bytes[i]! % chars.length]
  return out
}

export function buildTencentSoeWsUrl(input: TencentSoeWsInput): TencentSoeWsResult {
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const nonce = input.nonce ?? String(randomInt(100_000_000, 1_000_000_000))
  const voiceId = input.voiceId ?? randomVoiceId()

  // 新版接口无 JSON init 帧：全部初始化参数走 URL query
  const params: Record<string, string | number> = {
    secretid: input.secretId,
    timestamp: now,
    expired: now + EXPIRES_IN_SEC,
    nonce,
    server_engine_type: '16k_en', // 英文评测引擎
    voice_id: voiceId,
    voice_format: 1, // 0=pcm 1=wav 2=mp3 4=speex（上行整段 WAV，保留头）
    text_mode: 0,
    ref_text: input.refText,
    eval_mode: 1, // 句子级评测
    score_coeff: '1.0',
    sentence_info_enabled: 0,
    rec_mode: 1, // 录音模式：整段一次性上行，单连接单次评测（音频 ≤60s）
  }

  // 键字典序排序后拼接；encode=false 得签名原文（值裸拼），true 得 URL query（字符串值编码，
  // 数值原样 —— 与 SDK formatSignString 的 typeof === 'string' 判定一致）
  const keys = Object.keys(params).sort()
  const joinPairs = (encode: boolean): string =>
    keys
      .map((k) => {
        const v = params[k] as string | number
        return `${k}=${encode && typeof v === 'string' ? encodeURIComponent(v) : v}`
      })
      .join('&')

  const base = `${HOST}${PATH_PREFIX}${input.appId}`
  const signatureOrigin = `${base}?${joinPairs(false)}`
  const signature = createHmac('sha1', input.secretKey).update(signatureOrigin).digest('base64')
  const url = `wss://${base}?${joinPairs(true)}&signature=${encodeURIComponent(signature)}`
  return { url, signatureOrigin, signature }
}
