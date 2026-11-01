/**
 * /api/settings/soe 路由掩码回归测试 —— 评审 P1「GET/PUT 明文回显全部云密钥」的守卫。
 * 密钥只允许存在 ~/.ping-eng/settings.json 与 BFF 进程内存里，任何响应体一律掩码；
 * 编辑对话框回填掩码原样回传时，服务端必须识别并保留已存真值。
 * HOME 重定向到临时目录（server-settings 在模块顶层定死 SETTINGS_FILE）。
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REAL_HOME = process.env.HOME
let home = ''
let route: typeof import('../route')
let settings: typeof import('@/lib/server-settings')

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ping-eng-soe-'))
  vi.resetModules()
  process.env.HOME = home
  settings = await import('@/lib/server-settings')
  route = await import('../route')
})
afterEach(async () => {
  process.env.HOME = REAL_HOME
  await rm(home, { recursive: true, force: true })
  vi.resetModules()
})

function makeRequest(method: 'GET' | 'PUT', origin: string | null, body?: unknown): Request {
  return new Request('http://localhost:3000/api/settings/soe', {
    method,
    headers: origin ? { origin } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const REAL_TENCENT = { appId: '1259000001', secretId: 'AKIDzxxxxxxxxxxxxxxx', secretKey: 'Gu5t9xGARNxxxxxxxxxxxxx' }
const REAL_IFLYTEK = { appId: '2869xxxx', apiKey: '7a1fxxxxxxxxxxxxxxxxxxxxxxxx', apiSecret: 'ZTQ5YmExxxxxxxxxxxxxxxx' }

describe('同源守卫', () => {
  it('异源 Origin 直接 403，不读不写', async () => {
    const res = await route.GET(makeRequest('GET', 'http://evil.example.com'))
    expect(res.status).toBe(403)
  })
})

describe('密钥掩码（评审 P1 回归）', () => {
  it('PUT 写入真实密钥：响应只含掩码；磁盘存真值；GET 再读仍只回掩码', async () => {
    const put = await route.PUT(makeRequest('PUT', 'http://localhost:3000', {
      provider: 'tencent',
      proxyUrl: 'http://127.0.0.1:8788',
      tencent: REAL_TENCENT,
      iflytek: REAL_IFLYTEK,
    }))
    expect(put.status).toBe(200)

    const putBody = (await put.json()) as {
      tencent?: Record<string, string>
      iflytek?: Record<string, string>
    }
    // 响应体：任何密钥都不得是原文
    expect(putBody.tencent!.secretKey).toBe(settings.maskSecret(REAL_TENCENT.secretKey))
    expect(putBody.tencent!.secretKey).not.toContain(REAL_TENCENT.secretKey)
    expect(putBody.tencent!.secretId).toBe(settings.maskSecret(REAL_TENCENT.secretId))
    expect(putBody.iflytek!.apiKey).toBe(settings.maskSecret(REAL_IFLYTEK.apiKey))
    expect(putBody.iflytek!.apiSecret).toBe(settings.maskSecret(REAL_IFLYTEK.apiSecret))

    // 磁盘：明文真值（BFF 代理评分要用）
    await mkdir(join(home, '.ping-eng'), { recursive: true }) // 已存在，幂等
    const raw = JSON.parse(await readFile(join(home, '.ping-eng', 'settings.json'), 'utf-8')) as {
      soe?: { tencent?: Record<string, string>; iflytek?: Record<string, string> }
    }
    expect(raw.soe!.tencent!.secretKey).toBe(REAL_TENCENT.secretKey)
    expect(raw.soe!.iflytek!.apiKey).toBe(REAL_IFLYTEK.apiKey)

    // GET：同样只回掩码
    const get = await route.GET(makeRequest('GET', 'http://localhost:3000'))
    const getBody = (await get.json()) as { tencent?: Record<string, string> }
    expect(getBody.tencent!.secretKey).toBe(settings.maskSecret(REAL_TENCENT.secretKey))
  })

  it('PUT 掩码原样回传（未改密钥）→ 保留已存真值，不把掩码写进 settings.json', async () => {
    await route.PUT(makeRequest('PUT', 'http://localhost:3000', {
      provider: 'tencent',
      proxyUrl: 'http://127.0.0.1:8788',
      tencent: REAL_TENCENT,
    }))

    // 编辑对话框：GET 回填的掩码值原样提交，只改 proxyUrl
    const masked = settings.maskSecret(REAL_TENCENT.secretKey)
    const put2 = await route.PUT(makeRequest('PUT', 'http://localhost:3000', {
      provider: 'tencent',
      proxyUrl: 'http://192.168.1.10:8788',
      tencent: { appId: REAL_TENCENT.appId, secretId: settings.maskSecret(REAL_TENCENT.secretId), secretKey: masked },
    }))
    expect(put2.status).toBe(200)

    const raw = JSON.parse(await readFile(join(home, '.ping-eng', 'settings.json'), 'utf-8')) as {
      soe?: { proxyUrl?: string; tencent?: Record<string, string> }
    }
    expect(raw.soe!.proxyUrl).toBe('http://192.168.1.10:8788')
    expect(raw.soe!.tencent!.secretKey).toBe(REAL_TENCENT.secretKey) // 真值保留
    expect(raw.soe!.tencent!.secretId).toBe(REAL_TENCENT.secretId)
  })

  it('无已存密钥时 PUT 掩码形字符串按新值处理（无旧值可比对）', async () => {
    const put = await route.PUT(makeRequest('PUT', 'http://localhost:3000', {
      provider: 'azure',
      proxyUrl: 'http://127.0.0.1:8788',
      azure: { key: 'short', region: 'eastasia', host: 'eastasia.stt.speech.microsoft.com' },
    }))
    expect(put.status).toBe(200)
    const body = (await put.json()) as { azure?: Record<string, string> }
    // ≤8 字符整体打码；region/host 非密钥原样返回
    expect(body.azure!.key).toBe('***')
    expect(body.azure!.region).toBe('eastasia')
  })

  it('GET 无配置回落默认（provider mock，无任何密钥字段）', async () => {
    const res = await route.GET(makeRequest('GET', 'http://localhost:3000'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: string; azure?: unknown; tencent?: unknown; iflytek?: unknown }
    expect(body.provider).toBe('mock')
    expect(body.azure).toBeUndefined()
    expect(body.tencent).toBeUndefined()
    expect(body.iflytek).toBeUndefined()
  })

  it('非法 provider / 缺 proxyUrl → 400', async () => {
    expect((await route.PUT(makeRequest('PUT', 'http://localhost:3000', { provider: 'openai', proxyUrl: 'http://x' }))).status).toBe(400)
    expect((await route.PUT(makeRequest('PUT', 'http://localhost:3000', { provider: 'mock' }))).status).toBe(400)
  })
})
