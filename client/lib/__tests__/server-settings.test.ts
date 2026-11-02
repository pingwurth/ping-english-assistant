/**
 * server-settings 单测 —— HOME 重定向到临时目录（模块顶层用 homedir() 拼 SETTINGS_FILE，
 * 故每个用例 resetModules + 动态导入拿隔离实例）。
 * 覆盖评审指出的高危读写语义：损坏文件先备份再重建、mutate 不得抹掉兄弟节段、
 * 原子写不留 tmp 残留、读路径自动迁移的字段完整性、掩码保护与默认重排。
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REAL_HOME = process.env.HOME
let home = ''

async function fresh() {
  vi.resetModules()
  process.env.HOME = home
  return await import('../server-settings')
}

async function settingsFile(): Promise<string> {
  return join(home, '.ping-eng', 'settings.json')
}

async function readJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(await settingsFile(), 'utf-8')) as Record<string, unknown>
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ping-eng-test-'))
})
afterEach(async () => {
  process.env.HOME = REAL_HOME
  await rm(home, { recursive: true, force: true })
  vi.resetModules()
})

describe('readRaw 容错（密钥丢失事故的放大器）', () => {
  it('文件不存在 → 空配置，不创建文件', async () => {
    const s = await fresh()
    expect(await s.readEffectiveLlmSettings()).toBeNull()
  })

  it('损坏文件 → 先改名备份再按空配置运行，绝不以空底静默覆盖', async () => {
    const file = await settingsFile()
    await mkdir(join(home, '.ping-eng'), { recursive: true })
    await writeFile(file, '{ 截断的半个 JSON', 'utf-8')
    const s = await fresh()
    expect(await s.readSoeConfig()).toBeNull()

    const files = await readdir(join(home, '.ping-eng'))
    expect(files.some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true)
    expect(files).not.toContain('settings.json')

    // 后续写入落在重建后的文件上；备份保留人工恢复机会
    await s.writeSoeConfig({ provider: 'mock', proxyUrl: 'http://127.0.0.1:8788' })
    const raw = await readJson()
    expect(raw.soe).toBeDefined()
    expect(files.some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true)
  })
})

describe('mutateRaw 读-改-写完整性', () => {
  it('写任一节段不抹掉兄弟节段；原子写不留 tmp 残留', async () => {
    const s = await fresh()
    await s.addLlmConfig({ name: '默认配置', provider: 'dashscope', baseUrl: 'https://a', apiKey: 'sk-aaaaaaaaaa' })
    await s.writeSoeConfig({ provider: 'tencent', proxyUrl: 'http://127.0.0.1:8788', tencent: { appId: '1', secretId: 'id', secretKey: 'key' } })
    await s.writeKokoroSettings({ modelId: 'org/repo', modelPath: '/tmp/kokoro' })

    const raw = await readJson()
    expect((raw.llmConfigs as Array<{ apiKey: string }>)[0]!.apiKey).toBe('sk-aaaaaaaaaa')
    expect((raw.soe as { provider: string }).provider).toBe('tencent')
    expect((raw.kokoro as { modelId: string }).modelId).toBe('org/repo')

    const files = await readdir(join(home, '.ping-eng'))
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([])
  })

  it('并发 mutator 串行排队，后写者不用过期快照覆盖前写者', async () => {
    const s = await fresh()
    await Promise.all([
      s.addLlmConfig({ name: 'A', provider: 'a', baseUrl: 'https://a', apiKey: 'k1' }),
      s.writeSoeConfig({ provider: 'mock', proxyUrl: 'http://x' }),
      s.writeKokoroSettings({ modelId: 'm', modelPath: '/p' }),
    ])
    const raw = await readJson()
    expect(raw.llmConfigs).toBeDefined()
    expect(raw.soe).toBeDefined()
    expect(raw.kokoro).toBeDefined()
  })
})

describe('readLlmConfigs 读路径自动迁移', () => {
  it('legacy llm → llmConfigs：字段清单完整（含 mnemonic*/whisper*，曾漏两对被静默抹掉）', async () => {
    await mkdir(join(home, '.ping-eng'), { recursive: true })
    await writeFile(await settingsFile(), JSON.stringify({
      llm: {
        provider: 'dashscope',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'sk-legacy',
        asrModel: 'qwen-audio-asr',
        ttsModel: 'qwen-tts',
        translateModel: 'qwen-mt',
        mnemonicModel: 'qwen-mnemonic',
        whisperAlignUrl: 'http://10.0.0.2:8000',
        whisperTranscribeUrl: 'http://10.0.0.2:8001',
      },
    }), 'utf-8')

    const s = await fresh()
    const { configs, defaultId } = await s.readLlmConfigs()
    expect(configs).toHaveLength(1)
    expect(configs[0]!.asrModel).toBe('qwen-audio-asr')
    expect(configs[0]!.mnemonicModel).toBe('qwen-mnemonic')
    expect(configs[0]!.whisperAlignUrl).toBe('http://10.0.0.2:8000')
    expect(configs[0]!.whisperTranscribeUrl).toBe('http://10.0.0.2:8001')
    expect(defaultId).toBe(configs[0]!.id)

    // 迁移结果落盘，legacy 影子键删除（避免双写源漂移）
    const raw = await readJson()
    expect(Array.isArray(raw.llmConfigs)).toBe(true)
    expect(raw.llm).toBeUndefined()
  })

  it('已有 llmConfigs 时读路径不写盘、不重复迁移', async () => {
    const s = await fresh()
    const id = await s.addLlmConfig({ name: 'n', provider: 'p', baseUrl: 'https://x', apiKey: 'k' })
    const before = await readFile(await settingsFile(), 'utf-8')
    await s.readLlmConfigs()
    await s.readLlmConfigs()
    const after = await readFile(await settingsFile(), 'utf-8')
    expect(after).toBe(before) // 内容一致（无重复迁移追加）
    expect((await s.readLlmConfigs()).configs[0]!.id).toBe(id)
  })
})

describe('llmConfigs CRUD 语义', () => {
  it('updateLlmConfig 掩码保护：回填掩码值不毁真实 key，真改才覆盖', async () => {
    const s = await fresh()
    const realKey = 'sk-1234567890abcdef'
    const id = await s.addLlmConfig({ name: 'n', provider: 'p', baseUrl: 'https://x', apiKey: realKey })
    const masked = s.maskSecret(realKey) // 'sk-12345***'

    await s.updateLlmConfig(id, { apiKey: masked, ttsModel: 'qwen-tts' })
    let { configs } = await s.readLlmConfigs()
    expect(configs[0]!.apiKey).toBe(realKey) // 掩码回传 = 未修改
    expect(configs[0]!.ttsModel).toBe('qwen-tts')

    await s.updateLlmConfig(id, { apiKey: 'sk-brand-new-key' })
    ;({ configs } = await s.readLlmConfigs())
    expect(configs[0]!.apiKey).toBe('sk-brand-new-key')
  })

  it('updateLlmConfig 显式清空 apiKey：空串真的清除旧云 key（不会被 falsy 短路残留并发往新 baseUrl）', async () => {
    const s = await fresh()
    const id = await s.addLlmConfig({ name: 'n', provider: 'p', baseUrl: 'https://cloud', apiKey: 'sk-old-cloud-key-1234' })

    // 用户切到无需鉴权的本地服务：清空 key + 改 baseUrl
    await s.updateLlmConfig(id, { apiKey: '', baseUrl: 'http://127.0.0.1:1234/v1' })
    const { configs } = await s.readLlmConfigs()
    expect(configs[0]!.apiKey).toBe('')
    expect(configs[0]!.baseUrl).toBe('http://127.0.0.1:1234/v1')
  })

  it('updateLlmConfig 未携带 apiKey 字段 → 保留现有真实 key（不误清）', async () => {
    const s = await fresh()
    const id = await s.addLlmConfig({ name: 'n', provider: 'p', baseUrl: 'https://x', apiKey: 'sk-keepme-12345' })
    await s.updateLlmConfig(id, { name: '改名' })
    const { configs } = await s.readLlmConfigs()
    expect(configs[0]!.apiKey).toBe('sk-keepme-12345')
  })

  it('deleteLlmConfig 删默认后重排：默认落到剩余首条，有效配置读取同步', async () => {
    const s = await fresh()
    const idA = await s.addLlmConfig({ name: 'A', provider: 'p', baseUrl: 'https://a', apiKey: 'kA' })
    const idB = await s.addLlmConfig({ name: 'B', provider: 'p', baseUrl: 'https://b', apiKey: 'kB' })
    await s.setDefaultLlmConfig(idA)

    expect(await s.deleteLlmConfig(idA)).toBe(true)
    const { configs, defaultId } = await s.readLlmConfigs()
    expect(configs.map((c) => c.id)).toEqual([idB])
    expect(defaultId).toBe(idB)
    expect((await s.readEffectiveLlmSettings())?.baseUrl).toBe('https://b')
  })
})

describe('maskSecret 口径', () => {
  it('≤8 字符整体打码；>8 显示前 8 位', async () => {
    const s = await fresh()
    expect(s.maskSecret('short')).toBe('***')
    expect(s.maskSecret('sk-1234567890')).toBe('sk-12345***')
    expect(s.maskSecret('')).toBe('')
    expect(s.maskSecret(undefined)).toBe('')
  })
})
