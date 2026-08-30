import { NextResponse } from 'next/server'
import {
  readLlmConfigs,
  addLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  setDefaultLlmConfig,
  type LlmConfig,
} from '@/lib/server-settings'

function maskApiKey(config: LlmConfig): LlmConfig {
  return {
    ...config,
    apiKey: config.apiKey ? config.apiKey.slice(0, 8) + '***' : '',
  }
}

/** Derive TTS voices from config's provider/endpoint */
function getTtsVoices(config: LlmConfig) {
  const isMimo =
    config.ttsEndpoint?.includes('chat/completions') ||
    config.provider === 'mimo'
  if (isMimo) {
    return [
      { id: 'Mia', label: 'Mia · Female' },
      { id: 'Chloe', label: 'Chloe · Female' },
      { id: 'Milo', label: 'Milo · Male' },
      { id: 'Dean', label: 'Dean · Male' },
    ]
  }
  return [
    { id: 'longanlingxin', label: 'Lingxin · Female (双语)' },
    { id: 'longanlufeng', label: 'Lufeng · Male (双语)' },
  ]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const { configs, defaultId } = await readLlmConfigs()

    // 按 id 查询单条配置 — 返回完整信息（含明文 API Key，仅限本地请求）
    if (id) {
      const config = configs.find(c => c.id === id)
      if (!config) {
        return NextResponse.json({ error: 'Config not found' }, { status: 404 })
      }
      return NextResponse.json(config)
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
  try {
    const body = await request.json()
    const { name, provider, baseUrl, apiKey, asrModel, asrEndpoint, ttsModel, ttsEndpoint, translateModel, translateEndpoint, mnemonicModel, mnemonicEndpoint } = body

    if (!baseUrl || !apiKey) {
      return NextResponse.json({ error: 'Missing required fields: baseUrl, apiKey' }, { status: 400 })
    }

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
    })

    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Failed to add config' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
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

    // Regular update
    const ok = await updateLlmConfig(id, fields)
    if (!ok) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
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
