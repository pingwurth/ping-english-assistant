import { NextResponse } from 'next/server'
import { readKokoroSettings, writeKokoroSettings } from '@/lib/server-settings'

export async function GET() {
  try {
    const settings = await readKokoroSettings()
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({ error: 'Failed to read Kokoro settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { modelId, modelPath } = body

    if (!modelId || typeof modelId !== 'string') {
      return NextResponse.json({ error: 'Missing required field: modelId' }, { status: 400 })
    }
    if (!modelPath || typeof modelPath !== 'string') {
      return NextResponse.json({ error: 'Missing required field: modelPath' }, { status: 400 })
    }

    await writeKokoroSettings({
      modelId: modelId.trim(),
      modelPath: modelPath.trim(),
    })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save Kokoro settings' }, { status: 500 })
  }
}
