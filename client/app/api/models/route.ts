import { NextResponse } from 'next/server'
import { readLlmSettings } from '@/lib/server-settings'

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

export async function GET() {
  try {
    const settings = await readLlmSettings()
    if (!settings) {
      return NextResponse.json(
        { error: 'LLM settings not configured' },
        { status: 400 }
      )
    }

    // Normalize baseUrl - remove trailing slash and ensure it ends with /v1
    let baseUrl = settings.baseUrl.replace(/\/+$/, '')
    if (!baseUrl.endsWith('/v1')) {
      baseUrl = `${baseUrl}/v1`
    }

    const response = await fetch(`${baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error('Models fetch error:', response.status, errorText)
      return NextResponse.json(
        { error: `Failed to fetch models (${response.status})` },
        { status: response.status }
      )
    }

    const data: OpenAIModelsResponse = await response.json()

    // Filter and sort models - typically we want transcription models
    const models = data.data
      .map(m => m.id)
      .sort()

    return NextResponse.json({ models })
  } catch (error) {
    console.error('Models fetch error:', error)
    const message = error instanceof Error ? error.message : 'Failed to fetch models'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
