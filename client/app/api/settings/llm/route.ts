import { NextResponse } from 'next/server'
import { readLlmSettings, writeLlmSettings, type LlmSettings } from '@/lib/server-settings'

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
      apiKey: settings.apiKey.slice(0, 8) + '***',
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
      whisperAlignUrl, whisperTranscribeUrl,
    } = body

    if (!baseUrl || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: baseUrl, apiKey' },
        { status: 400 }
      )
    }

    const settings: LlmSettings = {
      provider: provider || '',
      baseUrl,
      apiKey,
      asrModel: asrModel || undefined,
      asrEndpoint: asrEndpoint || undefined,
      ttsModel: ttsModel || undefined,
      ttsEndpoint: ttsEndpoint || undefined,
      whisperAlignUrl: whisperAlignUrl || undefined,
      whisperTranscribeUrl: whisperTranscribeUrl || undefined,
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
