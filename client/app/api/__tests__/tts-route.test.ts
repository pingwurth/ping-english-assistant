/**
 * /api/tts multipart 传输回归 —— 评审 #53：
 * 音频不再 base64 塞 JSON（+33% 膨胀 + 客户端逐字节 atob 重组），
 * 响应为 multipart/form-data（meta JSON + 原始音频字节），formData() 可原生解析。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverSettings = vi.hoisted(() => ({
  readEffectiveLlmSettings: vi.fn(),
  readLlmConfigById: vi.fn(),
}))

vi.mock('@/lib/server-settings', () => serverSettings)

const llmMocks = vi.hoisted(() => ({ generateTts: vi.fn() }))
vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  return { ...actual, generateTts: llmMocks.generateTts }
})

let route: typeof import('@/app/api/tts/route')

beforeEach(async () => {
  vi.resetModules()
  serverSettings.readEffectiveLlmSettings.mockReset()
  serverSettings.readLlmConfigById.mockReset()
  llmMocks.generateTts.mockReset()
  route = await import('@/app/api/tts/route')
})

function makeRequest(text: string): Request {
  return new Request('http://localhost:3000/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: 'alloy', speed: 1.0 }),
  })
}

describe('POST /api/tts multipart 响应（评审 #53）', () => {
  it('音频以原始字节走 multipart，meta 为 JSON 文本，formData() 可解析', async () => {
    serverSettings.readEffectiveLlmSettings.mockResolvedValue({
      provider: 'mimo',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'real-key',
    })
    const audioBytes = new Uint8Array([1, 2, 3, 4, 5])
    llmMocks.generateTts.mockResolvedValue({ audioBuffer: audioBytes.buffer, durationMs: 4200 })

    const res = await route.POST(makeRequest('Hello world, this is a test.'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/)

    const fd = await res.formData()
    const metaRaw = fd.get('meta')
    expect(typeof metaRaw).toBe('string')
    const meta = JSON.parse(String(metaRaw)) as { taskId: string; durationMs: number; sentenceCount: number; srt: string }
    expect(meta.durationMs).toBe(4200)
    expect(meta.sentenceCount).toBeGreaterThan(0)
    expect(meta.srt).toContain('-->')

    const audio = fd.get('audio')
    expect(audio).toBeInstanceOf(Blob)
    expect(new Uint8Array(await (audio as Blob).arrayBuffer())).toEqual(audioBytes)
  })

  it('generateTts 抛 LlmError(API_KEY_MISSING) → 400（评审 #48 统一映射）', async () => {
    serverSettings.readEffectiveLlmSettings.mockResolvedValue({
      provider: 'mimo',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'real-key',
    })
    const { LlmError } = await import('@/lib/llm')
    llmMocks.generateTts.mockRejectedValue(new LlmError('API_KEY_MISSING', '请先在设置页配置 API Key'))

    const res = await route.POST(makeRequest('Hello world test.'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'API_KEY_MISSING' })
  })

  it('未配置模型 → 400，不出网', async () => {
    serverSettings.readEffectiveLlmSettings.mockResolvedValue(null)
    const res = await route.POST(makeRequest('Hello world test.'))
    expect(res.status).toBe(400)
    expect(llmMocks.generateTts).not.toHaveBeenCalled()
  })
})
