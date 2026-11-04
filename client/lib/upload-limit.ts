/**
 * multipart 上传体积预检 —— BFF 路由在 `await request.formData()`（全量缓冲进内存）
 * 之前的第一道闸：按声明 Content-Length 提前 413，防止把本地代理当任意大文件
 * 缓冲器直接 OOM。声明的上限按业务取值：转写吃整段材料音频（分钟级），SOE 评分
 * 按契约只有 ≤60s 句子级录音。
 *
 * 局限：Content-Length 是声明值，恶意客户端可改用 chunked 绕过 —— 本应用定位是
 * 本机/局域网自用工具，这道闸挡的是「诚实的大文件」与事故性 OOM，不是对抗性边界。
 */
import { NextResponse } from 'next/server'

/** 转写入口：整段材料音频（长播客/电影音轨）留足余量 */
export const MAX_TRANSCRIBE_UPLOAD_BYTES = 256 * 1024 * 1024
/** SOE 评分入口：契约 ≤60s 句子录音（16kHz mono WAV ≈ 1.9MB，留 16 倍余量） */
export const MAX_SOE_UPLOAD_BYTES = 32 * 1024 * 1024

/** 超限返回 413 响应；未超限/未声明返回 null（继续正常处理） */
export function rejectOversizedUpload(request: Request, maxBytes: number): Response | null {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    return NextResponse.json(
      { error: `上传内容过大（上限 ${Math.round(maxBytes / 1048576)} MB）` },
      { status: 413 },
    )
  }
  return null
}

/**
 * formData() 解析后的第二道闸（真实字节）：Content-Length 是声明值，chunked 请求
 * 干脆没有 —— 这道闸按已解析 Blob 的实际体积拦截，防的是「声明绕过 + 全量缓冲后才
 * 失败」的内存尖峰。三个上传路由（transcribe / transcribe/local / soe evaluate）
 * 统一走这里，消息单处维护（2026-11 全仓复审 c031/c067）。
 * 超限返回 413；未超限返回 null。
 */
export function rejectOversizedBlob(blob: Blob, maxBytes: number): Response | null {
  if (blob.size > maxBytes) {
    return NextResponse.json(
      { error: `上传内容过大（上限 ${Math.round(maxBytes / 1048576)} MB）` },
      { status: 413 },
    )
  }
  return null
}

/** JSON body 上限：三个 JSON 路由（tts/translate/mnemonic）的业务载荷远小于此 */
export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024

export type CappedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse }

/**
 * 带体积上限的 JSON body 读取（c034）：request.json() 与 formData() 一样把整个
 * body 缓冲进内存，App Router 路由没有框架级 body 限制 —— 上传路由的
 * rejectOversizedUpload 纪律原先不覆盖 JSON 路由。先按声明 Content-Length 预检，
 * 再按 text() 实际长度二次拦截（chunked 无声明可骗）。
 */
export async function readJsonBodyCapped(request: Request): Promise<CappedJsonResult> {
  const tooLarge = (): CappedJsonResult => ({
    ok: false,
    response: NextResponse.json(
      { error: `请求体过大（上限 ${Math.round(MAX_JSON_BODY_BYTES / 1048576)} MB）`, code: 'PAYLOAD_TOO_LARGE' },
      { status: 413 },
    ),
  })
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return tooLarge()
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: NextResponse.json({ error: '请求体必须为合法 JSON', code: 'INVALID_REQUEST' }, { status: 400 }) }
  }
  if (text.length > MAX_JSON_BODY_BYTES) return tooLarge()
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, response: NextResponse.json({ error: '请求体必须为合法 JSON', code: 'INVALID_REQUEST' }, { status: 400 }) }
  }
}
