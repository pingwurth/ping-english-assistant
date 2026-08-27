import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface LlmSettings {
  provider: string
  baseUrl: string
  apiKey: string

  /** ASR (语音识别) model name */
  asrModel?: string
  /** ASR endpoint path (default: /audio/transcriptions) */
  asrEndpoint?: string

  /** TTS (语音合成) model name */
  ttsModel?: string
  /** TTS endpoint path */
  ttsEndpoint?: string

  /** WhisperX alignment service URL (default: http://127.0.0.1:8765) */
  whisperAlignUrl?: string
  /** faster-whisper transcription service URL (default: http://127.0.0.1:8766) */
  whisperTranscribeUrl?: string
}

const SETTINGS_DIR = join(homedir(), '.ping-eng')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

export async function readLlmSettings(): Promise<LlmSettings | null> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(data)
    if (parsed.llm && parsed.llm.baseUrl && parsed.llm.apiKey) {
      const raw = parsed.llm as Record<string, unknown>
      // Backward compat: migrate old model/endpoint → asrModel/asrEndpoint
      if (raw.model && !raw.asrModel) raw.asrModel = raw.model
      if (raw.endpoint && !raw.asrEndpoint) raw.asrEndpoint = raw.endpoint
      delete raw.model
      delete raw.endpoint
      return raw as unknown as LlmSettings
    }
    return null
  } catch {
    return null
  }
}

export async function writeLlmSettings(settings: LlmSettings): Promise<void> {
  let existing: Record<string, unknown> = {}
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8')
    existing = JSON.parse(data)
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  existing.llm = settings

  await mkdir(SETTINGS_DIR, { recursive: true })
  await writeFile(SETTINGS_FILE, JSON.stringify(existing, null, 2), 'utf-8')
}
