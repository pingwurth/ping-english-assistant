import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface LlmSettings {
  provider: string
  baseUrl: string
  apiKey: string

  /** ASR (语音识别) model name */
  asrModel?: string | null
  /** ASR endpoint path */
  asrEndpoint?: string | null

  /** TTS (语音合成) model name */
  ttsModel?: string | null
  /** TTS endpoint path */
  ttsEndpoint?: string | null

  /** Translate (翻译) model name */
  translateModel?: string | null
  /** Translate endpoint path */
  translateEndpoint?: string | null

  /** Mnemonic (生词助记) model name — falls back to translateModel */
  mnemonicModel?: string | null
  /** Mnemonic endpoint path */
  mnemonicEndpoint?: string | null

  /** WhisperX alignment service URL */
  whisperAlignUrl?: string
  /** faster-whisper transcription service URL */
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

/**
 * 读取 settings.json。
 * - 文件不存在（首次启动）→ 返回 {}
 * - 文件存在但读取/解析失败（截断、损坏、手工编辑出错）→ 先把损坏文件改名备份，
 *   再返回 {} —— 绝不能静默当作空：否则任何 mutator 的回写会把损坏前的全部密钥永久抹掉，
 *   而备份文件保留了人工恢复的机会。
 */
async function readRaw(): Promise<Record<string, unknown>> {
  try {
    const data = await readFile(SETTINGS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT') return {}
    console.error('[server-settings] settings.json unreadable, backing it up before continuing:', err)
    try {
      await rename(SETTINGS_FILE, `${SETTINGS_FILE}.corrupt-${Date.now()}`)
    } catch { /* 备份失败（如权限）也无能为力，继续按空配置运行 */ }
    return {}
  }
}

/** 原子写：tmp + rename，进程崩溃/断电最多丢掉 tmp 文件，正式文件永远完整 */
async function writeRaw(obj: Record<string, unknown>): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true })
  const tmp = `${SETTINGS_FILE}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8')
  await rename(tmp, SETTINGS_FILE)
}

/** 密钥掩码（GET 返回 / 编辑回填用）：≤8 字符整体打码，>8 显示前 8 位 */
export function maskSecret(secret: string | null | undefined): string {
  if (!secret) return ''
  return secret.length <= 8 ? '***' : secret.slice(0, 8) + '***'
}

/* ── 读-改-写串行化 ──────────────────────────────────────
 * 所有 mutator 都是跨 await 的「读 raw → 改 → 写回」，无锁并发时
 * 后写者会用过期快照整段覆盖前写者。模块级 promise 队列保证同一进程内
 * 的读-改-写严格排队（两个标签页 = 两个进程，靠原子 rename 兜底不撕裂）。
 */
let mutationQueue: Promise<unknown> = Promise.resolve()

function enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(fn, fn)
  mutationQueue = run.then(() => undefined, () => undefined)
  return run
}

/** 串行化的读-改-写：fn 就地修改 raw 并返回业务结果，随后统一回写 */
async function mutateRaw<T>(fn: (raw: Record<string, unknown>) => T | Promise<T>): Promise<T> {
  return enqueueMutation(async () => {
    const raw = await readRaw()
    const result = await fn(raw)
    await writeRaw(raw)
    return result
  })
}

/* ── legacy single-config (unchanged API contract) ────── */

export async function readLlmSettings(): Promise<LlmSettings | null> {
  const parsed = await readRaw()
  const llm = parsed.llm as Record<string, unknown> | undefined
  if (!llm || !llm.baseUrl || !llm.apiKey) return null
  // Backward compat: migrate old model/endpoint → asrModel/asrEndpoint
  if (llm.model && !llm.asrModel) llm.asrModel = llm.model
  if (llm.endpoint && !llm.asrEndpoint) llm.asrEndpoint = llm.endpoint
  delete llm.model
  delete llm.endpoint
  return llm as unknown as LlmSettings
}

export async function writeLlmSettings(settings: LlmSettings): Promise<void> {
  await mutateRaw((raw) => {
    raw.llm = settings
  })
}

/**
 * 读取有效的 LLM 配置（优先 legacy `llm`，其次 `llmConfigs` 默认配置）
 *
 * 多模型配置系统将配置存在 `llmConfigs` 数组中，仅在设为默认时同步到 `llm`。
 * 此函数确保无论配置存储在哪，都能正确读取。
 */
export async function readEffectiveLlmSettings(): Promise<LlmSettings | null> {
  // 优先读 legacy `llm` key
  const legacy = await readLlmSettings()
  if (legacy) return legacy

  // fallback: 读 llmConfigs 的默认配置
  const { configs, defaultId } = await readLlmConfigs()
  if (configs.length === 0) return null

  const defaultConfig = defaultId
    ? configs.find(c => c.id === defaultId)
    : configs[0]

  return defaultConfig ? toLlmSettings(defaultConfig) : null
}

/* ── multi-model config CRUD ──────────────────────────── */

function generateConfigId(): string {
  return `cfg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

/** Read all configs; auto-migrate from legacy `llm` on first access */
export async function readLlmConfigs(): Promise<LlmConfigsResult> {
  // 走串行队列与写路径互斥；只有真正发生 migrate 时才回写
  return enqueueMutation(async () => {
    const raw = await readRaw()
    const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
    const defaultId = (raw.defaultLlmConfigId as string | null) ?? null

    // Auto-migrate: if no configs exist but legacy llm does, convert it
    if (configs.length === 0 && raw.llm) {
      const legacy = raw.llm as Record<string, unknown>
      if (legacy.baseUrl && legacy.apiKey) {
        // 字段清单必须与 LlmSettings 全集一致：漏掉的键会在后续 setDefaultLlmConfig
        // 回写 legacy 影子副本时被静默抹掉（曾漏 mnemonic*/whisper* 两对）
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
          mnemonicModel: legacy.mnemonicModel as string | undefined,
          mnemonicEndpoint: legacy.mnemonicEndpoint as string | undefined,
          whisperAlignUrl: legacy.whisperAlignUrl as string | undefined,
          whisperTranscribeUrl: legacy.whisperTranscribeUrl as string | undefined,
        }
        raw.llmConfigs = [migrated]
        raw.defaultLlmConfigId = migrated.id
        await writeRaw(raw)
        return { configs: [migrated], defaultId: migrated.id }
      }
    }

    return { configs, defaultId }
  })
}

/** Add a new config and return its id */
export async function addLlmConfig(config: Omit<LlmConfig, 'id'>): Promise<string> {
  return mutateRaw((raw) => {
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

    return id
  })
}

/** Update an existing config by id */
export async function updateLlmConfig(id: string, patch: Partial<LlmConfig>): Promise<boolean> {
  return mutateRaw((raw) => {
    const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
    const idx = configs.findIndex(c => c.id === id)
    if (idx === -1) return false

    const { apiKey: patchKey, ...rest } = patch as Record<string, unknown>
    // 掩码保护：编辑对话框回填的是掩码值，原样存回会毁掉真实 key —— 与现值掩码相同视为「未修改」
    const currentKey = String(configs[idx]?.apiKey ?? '')
    const keyIsUnchangedMask = typeof patchKey === 'string' && patchKey !== '' && patchKey === maskSecret(currentKey)
    const safePatch = patchKey && !keyIsUnchangedMask ? { ...rest, apiKey: patchKey } : rest
    configs[idx] = { ...configs[idx], ...safePatch, id }
    raw.llmConfigs = configs

    // Sync to legacy if this is the default
    if (raw.defaultLlmConfigId === id) {
      raw.llm = toLlmSettings(configs[idx]!)
    }

    return true
  })
}

/** Delete a config by id */
export async function deleteLlmConfig(id: string): Promise<boolean> {
  return mutateRaw((raw) => {
    const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
    const idx = configs.findIndex(c => c.id === id)
    if (idx === -1) return false

    configs.splice(idx, 1)
    raw.llmConfigs = configs

    // If deleted the default, reassign
    if (raw.defaultLlmConfigId === id) {
      const newDefaultId = configs.length > 0 ? configs[0]!.id : null
      raw.defaultLlmConfigId = newDefaultId
      raw.llm = newDefaultId ? toLlmSettings(configs[0]!) : undefined
    }

    return true
  })
}

/** Set a config as the default (syncs to legacy `llm`) */
export async function setDefaultLlmConfig(id: string): Promise<boolean> {
  return mutateRaw((raw) => {
    const configs = (raw.llmConfigs as LlmConfig[] | undefined) ?? []
    const config = configs.find(c => c.id === id)
    if (!config) return false

    raw.defaultLlmConfigId = id
    raw.llm = toLlmSettings(config)
    return true
  })
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
  await mutateRaw((raw) => {
    raw.localServices = services
  })
}

/* ── Kokoro TTS settings ─────────────────────────────── */

export interface KokoroSettings {
  /** HuggingFace 模型 ID（用于下载模型） */
  modelId: string
  /** 模型文件本地存储路径（绝对目录，模型文件存放于此） */
  modelPath: string
}

const DEFAULT_KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DEFAULT_KOKORO_MODEL_PATH = join(SETTINGS_DIR, 'kokoro-models')

export async function readKokoroSettings(): Promise<KokoroSettings> {
  // 纯读：不在 GET 里回写默认值（首读回写曾把损坏后的空配置固化，是密钥丢失事故的放大器）；
  // 默认值在首次 PUT 保存时自然持久化
  const raw = await readRaw()
  const k = raw.kokoro as Record<string, unknown> | undefined
  const settings: KokoroSettings = {
    modelId: (k?.modelId as string) || DEFAULT_KOKORO_MODEL_ID,
    modelPath: (k?.modelPath as string) || DEFAULT_KOKORO_MODEL_PATH,
  }
  // 确保模型目录存在
  await mkdir(settings.modelPath, { recursive: true })
  return settings
}

export async function writeKokoroSettings(settings: KokoroSettings): Promise<void> {
  await mutateRaw((raw) => {
    raw.kokoro = settings
  })
}

/* ── SOE 语音评测设置 ─────────────────────────────────── */

/** 语音评测配置（settings.json 的 soe section；密钥仅存本机，由 BFF 注入代理请求） */
export interface SoeSettingsConfig {
  provider: 'mock' | 'azure' | 'tencent' | 'iflytek'
  proxyUrl: string
  azure?: { key: string; region: string; host: string }
  tencent?: { appId: string; secretId: string; secretKey: string }
  iflytek?: { appId: string; apiKey: string; apiSecret: string }
}

/** 读取 soe 配置；section 缺失或 provider/proxyUrl 形态不符 → null（调用方回落默认值） */
export async function readSoeConfig(): Promise<SoeSettingsConfig | null> {
  const raw = await readRaw()
  const s = raw.soe as Partial<SoeSettingsConfig> | undefined
  if (!s) return null
  const providers = ['mock', 'azure', 'tencent', 'iflytek']
  if (typeof s.provider !== 'string' || !providers.includes(s.provider)) return null
  if (typeof s.proxyUrl !== 'string' || !s.proxyUrl.trim()) return null
  return s as SoeSettingsConfig
}

export async function writeSoeConfig(cfg: SoeSettingsConfig): Promise<void> {
  await mutateRaw((raw) => {
    raw.soe = cfg
  })
}
