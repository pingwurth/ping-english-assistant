import { NextResponse } from 'next/server'
import { readLocalServices, writeLocalServices } from '@/lib/server-settings'
import { sameOriginGuard } from '@/lib/api-guard'

export async function GET(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const services = await readLocalServices()
    return NextResponse.json(services)
  } catch {
    return NextResponse.json({ error: 'Failed to read local services' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const denied = sameOriginGuard(request)
  if (denied) return denied
  try {
    const body = await request.json()
    const { whisperAlignUrl, whisperTranscribeUrl } = body

    await writeLocalServices({
      whisperAlignUrl: whisperAlignUrl || undefined,
      whisperTranscribeUrl: whisperTranscribeUrl || undefined,
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to save local services' }, { status: 500 })
  }
}
