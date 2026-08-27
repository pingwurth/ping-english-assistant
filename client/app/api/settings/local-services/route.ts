import { NextResponse } from 'next/server'
import { readLocalServices, writeLocalServices } from '@/lib/server-settings'

export async function GET() {
  try {
    const services = await readLocalServices()
    return NextResponse.json(services)
  } catch {
    return NextResponse.json({ error: 'Failed to read local services' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
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
