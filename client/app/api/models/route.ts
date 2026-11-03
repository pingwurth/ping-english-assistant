import { NextResponse } from 'next/server'
import { OPENAI_MODELS_ENDPOINT, buildServiceUrl } from '@/lib/service-endpoints'
import { maskSecret, readEffectiveLlmSettings, readLlmConfigById } from '@/lib/server-settings'
import { sameOriginGuard, isUnsafeUpstreamUrl } from '@/lib/api-guard'

interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

interface OpenAIModelsResponse {
  data: OpenAIModel[]
  object: string
}

/** 用给定凭据拉取 OpenAI-compatible 模型列表 */
async function fetchModelList(baseUrl: string, apiKey: string): Promise<Response> {
  // Normalize baseUrl - remove trailing slash and ensure it ends with /v1
  let normalized = baseUrl.replace(/\/+$/, '')
  if (!normalized.endsWith('/v1')) {
    normalized = `${normalized}/v1`
  }
  return fetch(buildServiceUrl(normalized, OPENAI_MODELS_ENDPOINT), {
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
}

/**
 * GET — 用已保存的 legacy llm 配置拉模型列表。
 * 同源守卫（评审 #2）：本接口会拿真实 apiKey 向已存 baseUrl 出网，
 * 此前是 api-guard 白名单外少数裸奔路由之一。
 */
export async function GET(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const settings = await readEffectiveLlmSettings()
    if (!settings) {
      return NextResponse.json(
        { error: 'LLM settings not configured' },
        { status: 400 },
      )
    }

    const response = await fetchModelList(settings.baseUrl, settings.apiKey)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Models fetch error:', response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch models (${response.status})` },
        { status: response.status },
      )
    }

    const data = (await response.json()) as OpenAIModelsResponse

    // Filter and sort models - typically we want transcription models
    const models = (Array.isArray(data?.data) ? data.data : [])
      .map(m => m.id)
      .sort()

    return NextResponse.json({ models })
  } catch (error) {
    console.error('Models fetch error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch models'
    return NextResponse.json(
      { error: message },
      { status: 500 },
    )
  }
}

/**
 * POST — 用请求体里的临时配置 { baseUrl, apiKey } 拉模型列表，不写 settings.json。
 * 编辑已有配置时可传 configId + 掩码 key：服务端仅在 baseUrl 未变时用已存真实 key 探测；
 * 改 baseUrl 则必须重新输入真实 key，避免把掩码或旧配置的 key 发给无关上游。
 */
export async function POST(request: Request) {
  // 同源守卫 + 请求体里的 baseUrl 由客户端完全控制，服务端直接 fetch 构成 SSRF 面
  //（text/plain 简请不触发预检，恶意局域网页可盲打链路本地/元数据地址，评审 #2）
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = (await request.json().catch(() => null)) as {
      baseUrl?: unknown
      apiKey?: unknown
      configId?: unknown
    } | null
    const configId = typeof body?.configId === 'string' && body.configId ? body.configId : null
    const stored = configId ? await readLlmConfigById(configId) : null
    if (configId && !stored) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

    const baseUrl = (typeof body?.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : stored?.baseUrl) || ''
    const inputKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    let apiKey = inputKey
    if (stored) {
      const unchangedMask = inputKey !== '' && inputKey === maskSecret(stored.apiKey)
      const canUseStoredKey = (inputKey === '' || unchangedMask) && baseUrl === stored.baseUrl
      if (canUseStoredKey) apiKey = stored.apiKey
      else if (inputKey === '' || unchangedMask) {
        return NextResponse.json(
          { error: 'Base URL 已修改；请重新输入 API Key 后再探测模型列表' },
          { status: 400 },
        )
      }
    }

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Missing required fields: baseUrl, apiKey' }, { status: 400 })
    }
    if (isUnsafeUpstreamUrl(baseUrl)) {
      return NextResponse.json({ error: 'Base URL 协议或地址不被允许（仅 http/https，禁止链路本地/元数据地址）' }, { status: 400 })
    }

    const response = await fetchModelList(baseUrl, apiKey)
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Models fetch error:', response.status, errorText)
      return NextResponse.json({ error: `Failed to fetch models (${response.status})` }, { status: response.status })
    }

    const data = (await response.json()) as OpenAIModelsResponse
    const models = (Array.isArray(data?.data) ? data.data : []).map(m => m.id).sort()
    return NextResponse.json({ models })
  } catch (error) {
    console.error('Models fetch error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch models'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
