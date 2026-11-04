/**
 * multipart 上传体积预检单测（c055 回归）：formData() 全量缓冲前的第一道闸。
 * 含 /api/soe/evaluate 的接线验证（超限在读取 settings.json 之前就被 413 拦下）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SOE_UPLOAD_BYTES, MAX_TRANSCRIBE_UPLOAD_BYTES, rejectOversizedUpload } from '../upload-limit'

function requestWithLength(bytes: number | null): Request {
  const headers = new Headers()
  if (bytes !== null) headers.set('content-length', String(bytes))
  // 真实 Request（localhost 属 api-guard 默认可信 Host）：/api/soe/evaluate 已接入
  // 同源守卫（评审 #2），纯 { headers } 伪对象会被拦成 403，无法测到限流后的业务分支
  return new Request('http://localhost:3000/api/soe/evaluate', { method: 'POST', headers })
}

describe('rejectOversizedUpload', () => {
  it('声明体积超限 → 413 响应', () => {
    const res = rejectOversizedUpload(requestWithLength(MAX_TRANSCRIBE_UPLOAD_BYTES + 1), MAX_TRANSCRIBE_UPLOAD_BYTES)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(413)
  })

  it('上限内 / 恰好等于上限 / 无声明（chunked）→ 放行（null）', () => {
    expect(rejectOversizedUpload(requestWithLength(1024), MAX_TRANSCRIBE_UPLOAD_BYTES)).toBeNull()
    expect(rejectOversizedUpload(requestWithLength(MAX_TRANSCRIBE_UPLOAD_BYTES), MAX_TRANSCRIBE_UPLOAD_BYTES)).toBeNull()
    expect(rejectOversizedUpload(requestWithLength(null), MAX_TRANSCRIBE_UPLOAD_BYTES)).toBeNull()
  })

  it('畸形声明（非数字）不误伤：放行，交由后续真实解析处理', () => {
    const headers = new Headers({ 'content-length': 'abc' })
    expect(rejectOversizedUpload({ headers } as unknown as Request, 100)).toBeNull()
  })

  it('SOE 入口上限显著小于转写入口（句子录音 vs 整段材料）', () => {
    expect(MAX_SOE_UPLOAD_BYTES).toBeLessThan(MAX_TRANSCRIBE_UPLOAD_BYTES)
  })
})

describe('/api/soe/evaluate 接线', () => {
  const REAL_HOME = process.env.HOME
  let home = ''

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ping-eng-upload-'))
    vi.resetModules()
    process.env.HOME = home
  })
  afterEach(async () => {
    process.env.HOME = REAL_HOME
    await rm(home, { recursive: true, force: true })
    vi.resetModules()
  })

  it('超限请求在触碰 formData / settings.json 之前即 413', async () => {
    const route = await import('@/app/api/soe/evaluate/route')
    const req = requestWithLength(MAX_SOE_UPLOAD_BYTES + 1)
    const res = await route.POST(req)
    expect(res.status).toBe(413)
  })

  it('限内请求正常进入业务分支（无 soe 配置 → 400 演示模式）', async () => {
    const route = await import('@/app/api/soe/evaluate/route')
    const res = await route.POST(requestWithLength(2048))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('演示模式')
  })
})

/* ── readJsonBodyCapped（三轮复审 c005 补测）：字节上限语义与 CJK 放大 ── */

import { MAX_JSON_BODY_BYTES, readJsonBodyCapped } from '../upload-limit'

function jsonRequest(body: string, contentLength?: number | null): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (contentLength !== null) headers.set('content-length', String(contentLength ?? Buffer.byteLength(body)))
  return new Request('http://x/api/tts', { method: 'POST', headers, body })
}

describe('readJsonBodyCapped', () => {
  it('正常 body 解析返回；非法 JSON → 400 INVALID_REQUEST', async () => {
    const ok = await readJsonBodyCapped(jsonRequest('{"a":1}'))
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.body).toEqual({ a: 1 })
    const bad = await readJsonBodyCapped(jsonRequest('{oops'))
    expect(bad.ok).toBe(false)
  })

  it('按字节而非 UTF-16 码元比较（quick c005）：CJK body 每字符 3 字节只计 1 码元', async () => {
    // 90 万个汉字 ≈ 2.7MB 字节 / 0.9M 码元 —— 码元比较会放行,字节比较必须 413
    const cjk = '汉'.repeat(900_000)
    const body = JSON.stringify({ text: cjk })
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_JSON_BODY_BYTES)
    expect(body.length).toBeLessThan(MAX_JSON_BODY_BYTES) // 前置自证:码元数确实低于上限
    const res = await readJsonBodyCapped(jsonRequest(body, null)) // chunked:无 Content-Length
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })

  it('声明 Content-Length 超限 → 预检即拒,不读 body', async () => {
    const res = await readJsonBodyCapped(jsonRequest('{}', MAX_JSON_BODY_BYTES + 1))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(413)
  })
})
