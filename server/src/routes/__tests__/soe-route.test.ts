import { describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { buildWav, mkEnv, TEST_PCM } from '../../testing/fixtures'

const BOUNDARY = 'test-boundary-7f3a'

/** 手写 multipart body：文本字段 + 单文件（audio） */
function multipartBody(parts: Array<{ name: string; value?: string; filename?: string; content?: Buffer }>): Buffer {
  const chunks: Buffer[] = []
  for (const p of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`))
    if (p.filename) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n` +
            'Content-Type: audio/wav\r\n\r\n',
        ),
      )
      chunks.push(p.content ?? Buffer.alloc(0))
      chunks.push(Buffer.from('\r\n'))
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value ?? ''}\r\n`))
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`))
  return Buffer.concat(chunks)
}

function post(app: Awaited<ReturnType<typeof buildApp>>, parts: Array<{ name: string; value?: string; filename?: string; content?: Buffer }>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/soe/evaluate',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipartBody(parts),
  })
}

const audioPart = { name: 'audio', filename: 'a.wav', content: buildWav(TEST_PCM) }

describe('POST /api/v1/soe/evaluate（provider 解析与校验）', () => {
  it('无 provider 字段 → 200，走默认 mock，返回整数口径结果', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello world' }, audioPart])
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(Number.isInteger(body.total)).toBe(true)
    expect(Number.isInteger(body.accuracy)).toBe(true)
    expect(Array.isArray(body.words)).toBe(true)
  })

  it('provider=mock → 200', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello' }, { name: 'provider', value: 'mock' }, audioPart])
    expect(res.statusCode).toBe(200)
  })

  it("provider=azure 无凭据 → 503 PROVIDER_UNAVAILABLE，detail.available=['mock']", async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello' }, { name: 'provider', value: 'azure' }, audioPart])
    expect(res.statusCode).toBe(503)
    const body = res.json()
    expect(body.code).toBe('PROVIDER_UNAVAILABLE')
    expect(body.detail).toEqual({ provider: 'azure', available: ['mock'] })
  })

  it('provider=bogus → 400 BAD_REQUEST', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello' }, { name: 'provider', value: 'bogus' }, audioPart])
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
  })

  it('缺 refText → 400', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [audioPart])
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
  })
})

describe('GET /healthz', () => {
  it('返回默认 provider 与已注册 provider 列表', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, soeProvider: 'mock', soeProviders: ['mock'] })
  })
})

describe('POST /api/v1/soe/evaluate（请求级 creds）', () => {
  it("provider=azure + creds 齐备 → 非 503（越过注册表解析，fake 密钥走到上游错误）", async () => {
    const app = await buildApp(mkEnv({ SOE_TIMEOUT_MS: 2000, SOE_RETRY: 0 }), { logger: false })
    const res = await post(app, [
      { name: 'refText', value: 'hello' },
      { name: 'provider', value: 'azure' },
      { name: 'creds', value: JSON.stringify({ azure: { key: 'FAKE', region: 'not-a-real-region' } }) },
      audioPart,
    ])
    expect(res.statusCode).not.toBe(503)
    expect(res.json().code).not.toBe('PROVIDER_UNAVAILABLE')
  })

  it('provider=tencent 无 creds → 503 PROVIDER_UNAVAILABLE', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello' }, { name: 'provider', value: 'tencent' }, audioPart])
    expect(res.statusCode).toBe(503)
    expect(res.json().code).toBe('PROVIDER_UNAVAILABLE')
  })

  it('creds 非法 JSON → 400 BAD_REQUEST', async () => {
    const app = await buildApp(mkEnv(), { logger: false })
    const res = await post(app, [{ name: 'refText', value: 'hello' }, { name: 'creds', value: '{oops' }, audioPart])
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
    expect(res.json().message).toContain('JSON')
  })
})
