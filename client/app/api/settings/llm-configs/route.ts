import { NextResponse } from 'next/server'
import {
  readLlmConfigs,
  addLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  setDefaultLlmConfig,
  maskSecret,
  type LlmConfig,
} from '@/lib/server-settings'
import { isUnsafeUpstreamUrl, sameOriginGuard, unsafeUpstreamResponse } from '@/lib/api-guard'
import { getTtsVoiceCatalog, isOpenAiCompatTts } from '@/lib/service-endpoints'

function maskApiKey(config: LlmConfig): LlmConfig {
  return {
    ...config,
    apiKey: maskSecret(config.apiKey),
  }
}

/** Derive TTS voices from config's provider/endpoint —— 音色目录与 OpenAI 兼容探测
 *  单源于 service-endpoints（c070：原先此处硬编码两份列表 + ad-hoc 探测） */
function getTtsVoices(config: LlmConfig) {
  const provider = isOpenAiCompatTts(config.provider, config.ttsEndpoint) ? 'mimo' : config.provider
  return getTtsVoiceCatalog(provider)
}

export async function GET(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const { configs, defaultId } = await readLlmConfigs()

    // 按 id 查询单条配置 — 同样只返回掩码 key（编辑对话框回填掩码值，
    // PUT 时服务端识别掩码并保留原 key，见 updateLlmConfig 的掩码保护）
    if (id) {
      const config = configs.find(c => c.id === id)
      if (!config) {
        return NextResponse.json({ error: 'Config not found' }, { status: 404 })
      }
      return NextResponse.json(maskApiKey(config))
    }

    return NextResponse.json({
      configs: configs.map(c => ({
        ...maskApiKey(c),
        ttsVoices: c.ttsModel ? getTtsVoices(c) : [],
      })),
      defaultId,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to read configs' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const { name, provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, translateModel, translateEndpoint, mnemonicModel, mnemonicEndpoint, whisperAlignUrl, whisperTranscribeUrl } = body

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Missing required fields: baseUrl, apiKey' }, { status: 400 })
    }
    // 持久化前过 SSRF 门（c066）：不安全的 baseUrl 不进 settings.json —— 出网路由
    // 各自的运行时门是第二道防线，第一道在写入点
    if (typeof baseUrl === 'string' && isUnsafeUpstreamUrl(baseUrl)) return unsafeUpstreamResponse()

    const id = await addLlmConfig({
      name: name || provider || '新配置',
      provider: provider || '',
      baseUrl,
      apiKey,
      asrModel,
      asrEndpoint,
      ttsModel,
      ttsEndpoint,
      translateModel,
      translateEndpoint,
      mnemonicModel,
      mnemonicEndpoint,
      whisperAlignUrl,
      whisperTranscribeUrl,
    })

    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Failed to add config' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const { id, action, ...fields } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    if (action === 'setDefault') {
      const ok = await setDefaultLlmConfig(id)
      if (!ok) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
      return NextResponse.json({ success: true })
    }

    // Regular update —— baseUrl 变更同样过 SSRF 门（c066）
    if (typeof fields.baseUrl === 'string' && fields.baseUrl && isUnsafeUpstreamUrl(fields.baseUrl)) {
      return unsafeUpstreamResponse()
    }
    const ok = await updateLlmConfig(id, fields)
    if (!ok) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const ok = await deleteLlmConfig(id)
    if (!ok) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete config' }, { status: 500 })
  }
}
