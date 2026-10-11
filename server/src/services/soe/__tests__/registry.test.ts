import { describe, expect, it } from 'vitest'
import { createSoeProviderRegistry } from '../index'
import { mkEnv } from '../../../testing/fixtures'

describe('createSoeProviderRegistry', () => {
  it('无任何凭据 → 仅 mock', () => {
    const r = createSoeProviderRegistry(mkEnv())
    expect([...r.providers.keys()]).toEqual(['mock'])
    expect(r.defaultName).toBe('mock')
  })

  it('仅 azure 凭据 → mock + azure', () => {
    const r = createSoeProviderRegistry(mkEnv({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'eastasia' }))
    expect([...r.providers.keys()]).toEqual(['mock', 'azure'])
  })

  it('tencent 凭据 → 注册表含 tencent', () => {
    const r = createSoeProviderRegistry(mkEnv({ TENCENT_SECRET_ID: 'id', TENCENT_SECRET_KEY: 'key' }))
    expect([...r.providers.keys()]).toContain('tencent')
  })

  it('iflytek 凭据 → 注册表含 iflytek', () => {
    const r = createSoeProviderRegistry(
      mkEnv({ IFLYTEK_APP_ID: 'app', IFLYTEK_API_KEY: 'k', IFLYTEK_API_SECRET: 's' }),
    )
    expect([...r.providers.keys()]).toContain('iflytek')
  })

  it('全凭据 → 四个 provider 全注册', () => {
    const r = createSoeProviderRegistry(
      mkEnv({
        AZURE_SPEECH_KEY: 'k',
        AZURE_SPEECH_REGION: 'eastasia',
        TENCENT_SECRET_ID: 'id',
        TENCENT_SECRET_KEY: 'key',
        IFLYTEK_APP_ID: 'app',
        IFLYTEK_API_KEY: 'k',
        IFLYTEK_API_SECRET: 's',
      }),
    )
    expect([...r.providers.keys()]).toEqual(['mock', 'azure', 'tencent', 'iflytek'])
  })

  it('defaultName 跟随 SOE_PROVIDER', () => {
    const r = createSoeProviderRegistry(
      mkEnv({ SOE_PROVIDER: 'tencent', TENCENT_SECRET_ID: 'id', TENCENT_SECRET_KEY: 'key' }),
    )
    expect(r.defaultName).toBe('tencent')
  })
})
