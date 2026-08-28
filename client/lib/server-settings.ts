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

  /** Translate (翻译) model name */
  translateModel?: string
  /** Translate endpoint path (default: /chat/completions) */
  translateEndpoint?: string

  /** WhisperX alignment service URL (default: http://127.0.0.1:8765) */
  whisperAlignUrl?: string
  /** faster-whisper transcription service URL (default: http://127.0.0.1:8766) */
  whisperTranscribeUrl?: string
}

/** Multi-model config entry — extends LlmSettings with identity and display name */
export interface LlmConfig extends LlmSettings {
  id: string
  name: string
}

export interface LocalServices {
  whisperAlignUrl?: string
  whisperTranscribeUrl?: string
}

export interface LlmConfigsResult {
  configs: LlmConfig[]
  defaultId: string | null
}

const SETTINGS_DIR = join(homedir(), '.ping-eng')
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json')

/* ── raw file helpers ─────────────────────────────────── */

async function readRaw(): Promise<Record<string, unknown>> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    console.error('[server-settings] Failed to read/parse settings file:', err)
    return {}
  }
}

async function writeRaw(obj: Record<string, unknown>): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true })
  await writeFile(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf-8')
}

/* ── legacy single-config (unchanged API contract) ────── */

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
  const existing = await readRaw()
  existing.llm = settings
  await writeRaw(existing)
}

/* ── multi-model config CRUD ──────────────────────────── */

function generateConfigId(): string {
  return `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/** Read all configs; auto-migrate from legacy `llm` on first access */
export async function readLlmConfigs(): Promise<LlmConfigsResult> {
  const raw = await readRaw()
  let configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
  const defaultId = (raw.defaultLlmConfigId as string | null) ?? null

  // Auto-migrate: if no configs exist but legacy llm does, convert it
  if (configs.length === 0 && raw.llm) {
    const legacy = raw.llm as Record<string, unknown>
    if (legacy.baseUrl && legacy.apiKey) {
      const migrated: LlmConfig = {
        id: generateConfigId(),
        name: String(legacy.provider || '默认配置'),
        provider: String(legacy.provider || ''),
        baseUrl: String(legacy.baseUrl || ''),
        apiKey: String(legacy.apiKey || ''),
        asrModel: legacy.asrModel as string | undefined,
        asrEndpoint: legacy.asrEndpoint as string | undefined,
        ttsModel: legacy.ttsModel as string | undefined,
        ttsEndpoint: legacy.ttsEndpoint as string | undefined,
        translateModel: legacy.translateModel as string | undefined,
        translateEndpoint: legacy.translateEndpoint as string | undefined,
      }
      configs = [migrated]
      raw.llmConfigs = configs
      raw.defaultLlmConfigId = migrated.id
      await writeRaw(raw)
      return { configs, defaultId: migrated.id }
    }
  }

  return { configs, defaultId }
}

/** Add a new config and return its id */
export async function addLlmConfig(config: Omit<LlmConfig, 'id'>): Promise<string> {
  const raw = await readRaw()
  const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
  const id = generateConfigId()
  const newConfig: LlmConfig = { ...config, id }
  configs.push(newConfig)
  raw.llmConfigs = configs

  // If first config, make it the default and sync to legacy
  if (configs.length === 1 || !raw.defaultLlmConfigId) {
    raw.defaultLlmConfigId = id
    raw.llm = toLlmSettings(newConfig)
  }

  await writeRaw(raw)
  return id
}

/** Update an existing config by id */
export async function updateLlmConfig(id: string, patch: Partial<LlmConfig>): Promise<boolean> {
  const raw = await readRaw()
  const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
  const idx = configs.findIndex(c => c.id === id)
  if (idx === -1) return false

  const { apiKey: patchKey, ...rest } = patch as Record<string, unknown>
  const safePatch = patchKey ? { ...rest, apiKey: patchKey } : rest
  configs[idx] = { ...configs[idx], ...safePatch, id }
  raw.llmConfigs = configs

  // Sync to legacy if this is the default
  if (raw.defaultLlmConfigId === id) {
    raw.llm = toLlmSettings(configs[idx])
  }

  await writeRaw(raw)
  return true
}

/** Delete a config by id */
export async function deleteLlmConfig(id: string): Promise<boolean> {
  const raw = await readRaw()
  const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
  const idx = configs.findIndex(c => c.id === id)
  if (idx === -1) return false

  configs.splice(idx, 1)
  raw.llmConfigs = configs

  // If deleted the default, reassign
  if (raw.defaultLlmConfigId === id) {
    const newDefaultId = configs.length > 0 ? configs[0].id : null
    raw.defaultLlmConfigId = newDefaultId
    raw.llm = newDefaultId ? toLlmSettings(configs[0]) : undefined
  }

  await writeRaw(raw)
  return true
}

/** Set a config as the default (syncs to legacy `llm`) */
export async function setDefaultLlmConfig(id: string): Promise<boolean> {
  const raw = await readRaw()
  const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
  const config = configs.find(c => c.id === id)
  if (!config) return false

  raw.defaultLlmConfigId = id
  raw.llm = toLlmSettings(config)
  await writeRaw(raw)
  return true
}

/** Read a single config by id, returned as LlmSettings (no id/name) */
export async function readLlmConfigById(id: string): Promise<LlmSettings | null> {
  const { configs } = await readLlmConfigs()
  const config = configs.find(c => c.id === id)
  return config ? toLlmSettings(config) : null
}

/** Strip id/name to produce a plain LlmSettings for legacy consumers */
function toLlmSettings(config: LlmConfig): LlmSettings {
  const { id: _id, name: _name, ...settings } = config
  return settings
}

/* ── local services (whisper) ─────────────────────────── */

export async function readLocalServices(): Promise<LocalServices> {
  const raw = await readRaw()
  const ls = raw.localServices as Record<string, unknown> | undefined
  return {
    whisperAlignUrl: ls?.whisperAlignUrl as string | undefined,
    whisperTranscribeUrl: ls?.whisperTranscribeUrl as string | undefined,
  }
}

export async function writeLocalServices(services: LocalServices): Promise<void> {
  const raw = await readRaw()
  raw.localServices = services
  await writeRaw(raw)
}
