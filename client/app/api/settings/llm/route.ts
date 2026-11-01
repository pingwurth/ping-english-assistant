import { NextResponse } from 'next/server'
import { readLlmSettings, writeLlmSettings, maskSecret, type LlmSettings } from '@/lib/server-settings'

/** 根据 provider 返回对应的云端 TTS 音色列表 */
function getTtsVoices(settings: LlmSettings) {
  const isMimo =
    settings.ttsEndpoint?.includes('chat/completions') ||
    settings.provider === 'mimo'
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

export async function GET() {
  try {
    const settings = await readLlmSettings()
    if (!settings) {
      return NextResponse.json({ configured: false })
    }

    // Mask API key for security
    return NextResponse.json({
      configured: true,
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      asrModel: settings.asrModel || '',
      asrEndpoint: settings.asrEndpoint || '',
      ttsModel: settings.ttsModel || '',
      ttsEndpoint: settings.ttsEndpoint || '',
      ttsVoices: getTtsVoices(settings),
      whisperAlignUrl: settings.whisperAlignUrl || '',
      whisperTranscribeUrl: settings.whisperTranscribeUrl || '',
      apiKey: maskSecret(settings.apiKey),
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read settings' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      provider, baseUrl, apiKey,
      asrModel, asrEndpoint,
      ttsModel, ttsEndpoint,
      translateModel, translateEndpoint,
      mnemonicModel, mnemonicEndpoint,
      whisperAlignUrl, whisperTranscribeUrl,
    } = body

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: baseUrl, apiKey' },
        { status: 400 }
      )
    }

    // 与现存 llm 段浅合并：只 POST 部分字段（如探测性调用）不再剥掉其余模型配置；
    // apiKey 为已存 key 的掩码形式时视为「未修改」，保留真值
    const existing = await readLlmSettings()
    const keyUnchanged = existing?.apiKey && apiKey === maskSecret(existing.apiKey)

    const settings: LlmSettings = {
      ...existing,
      provider: provider ?? existing?.provider ?? '',
      baseUrl,
      apiKey: keyUnchanged ? existing!.apiKey : apiKey,
      asrModel: asrModel ?? existing?.asrModel,
      asrEndpoint: asrEndpoint ?? existing?.asrEndpoint,
      ttsModel: ttsModel ?? existing?.ttsModel,
      ttsEndpoint: ttsEndpoint ?? existing?.ttsEndpoint,
      translateModel: translateModel ?? existing?.translateModel,
      translateEndpoint: translateEndpoint ?? existing?.translateEndpoint,
      mnemonicModel: mnemonicModel ?? existing?.mnemonicModel,
      mnemonicEndpoint: mnemonicEndpoint ?? existing?.mnemonicEndpoint,
      whisperAlignUrl: whisperAlignUrl ?? existing?.whisperAlignUrl,
      whisperTranscribeUrl: whisperTranscribeUrl ?? existing?.whisperTranscribeUrl,
    }
    await writeLlmSettings(settings)

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    )
  }
}
