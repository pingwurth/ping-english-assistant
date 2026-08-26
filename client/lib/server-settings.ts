import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface LlmSettings {
  provider: string
  baseUrl: string
  apiKey: string
  model?: string
  endpoint?: string
  /** WhisperX alignment service URL (default: http://127.0.0.1:8765) */
  whisperAlignUrl?: string
}

const SETTINGS_DIR = join(homedir(), '.ping-eng')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

export async function readLlmSettings(): Promise<LlmSettings | null> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8')
    const parsed = JSON.parse(data)
    if (parsed.llm && parsed.llm.baseUrl && parsed.llm.apiKey) {
      return parsed.llm as LlmSettings
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
