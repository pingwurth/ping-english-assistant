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
