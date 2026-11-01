import { NextResponse } from 'next/server'
import { readKokoroSettings, writeKokoroSettings } from '@/lib/server-settings'
import { isSameOriginRequest, forbiddenOriginResponse } from '@/lib/api-guard'

function guard(request: Request): Response | null {
  return isSameOriginRequest(request.headers.get('origin'), request.headers.get('host'), request.url)
    ? null
    : forbiddenOriginResponse()
}

export async function GET(request: Request) {
  const denied = guard(request)
  if (denied) return denied
  try {
    const settings = await readKokoroSettings()
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({ error: 'Failed to read Kokoro settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const denied = guard(request)
  if (denied) return denied
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
