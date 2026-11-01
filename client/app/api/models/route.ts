import { NextResponse } from 'next/server'
import { OPENAI_MODELS_ENDPOINT, buildServiceUrl } from '@/lib/service-endpoints'
import { readEffectiveLlmSettings } from '@/lib/server-settings'

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
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })
}

/**
 * GET — 用已保存的 legacy llm 配置拉模型列表。
 */
export async function GET() {
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
 * POST — 用请求体里的临时配置 { baseUrl, apiKey } 拉模型列表，不读也不写 settings.json。
 * 供配置对话框「获取模型列表」按钮使用：探测性质的操作不应落盘
 * （历史实现先 POST /api/settings/llm 再 GET，一次探测就把 legacy llm 段的模型字段剥光）。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { baseUrl?: unknown; apiKey?: unknown } | null
    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Missing required fields: baseUrl, apiKey' }, { status: 400 })
    }

    const response = await fetchModelList(baseUrl, apiKey)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Models fetch error:', response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch models (${response.status})` },
        { status: response.status },
      )
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
