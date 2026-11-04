/**
 * service-endpoints 解析层回归（2026-11 全仓复审 c051）：
 * 该模块自称「唯一允许维护路径常量的地方」，注释记录了双表漏同步的历史事故
 * （qwen 只在一侧归一 → ASR 静默落错 provider 出空 SRT）与 /vN 去重约定，
 * 却没有测试锁住这些它要防的事故。
 */
import { describe, expect, it } from 'vitest'
import {
  buildServiceUrl,
  getDefaultEndpoint,
  getDefaultModel,
  getDefaultVoice,
  getTtsVoiceCatalog,
  isOpenAiCompatTts,
  normalizeProviderAlias,
  resolveServiceUrl,
} from '../service-endpoints'

describe('normalizeProviderAlias（qwen 别名单侧漏同步的历史事故）', () => {
  it("qwen 归一为 dashscope：endpoint/model/voice 三张表同口径", () => {
    expect(normalizeProviderAlias('qwen')).toBe('dashscope')
    expect(getDefaultEndpoint('qwen', 'asr')).toBe(getDefaultEndpoint('dashscope', 'asr'))
    expect(getDefaultModel('qwen', 'asr')).toBe(getDefaultModel('dashscope', 'asr'))
    expect(getDefaultVoice('qwen')).toBe(getDefaultVoice('dashscope'))
  })

  it('未知 provider 原样保留（自定义 OpenAI 兼容网关）', () => {
    expect(normalizeProviderAlias('my-gateway')).toBe('my-gateway')
    // endpoint 回落 mimo（OpenAI-compatible）默认，model/voice 回落空/alloy
    expect(getDefaultEndpoint('my-gateway', 'tts')).toBe('/chat/completions')
    expect(getDefaultModel('my-gateway', 'tts')).toBe('')
    expect(getDefaultVoice('my-gateway')).toBe('alloy')
  })
})

describe('buildServiceUrl /vN 去重（c071 的分叉点）', () => {
  it('baseUrl 与 endpoint 双版本前缀只保留一个（Ollama /v1 惯例）', () => {
    expect(buildServiceUrl('http://h:11434/v1', '/v1/chat/completions')).toBe('http://h:11434/v1/chat/completions')
    expect(buildServiceUrl('http://gw/v2', '/v1/chat/completions')).toBe('http://gw/v2/chat/completions')
  })

  it('无版本 baseUrl 原样拼接；尾斜杠去除', () => {
    expect(buildServiceUrl('http://h:8788/', '/api/v1/soe/evaluate')).toBe('http://h:8788/api/v1/soe/evaluate')
    expect(buildServiceUrl('https://api.example.com', 'v2/x')).toBe('https://api.example.com/v2/x')
  })

  it('resolveServiceUrl：endpoint 缺省取 provider 默认值', () => {
    expect(resolveServiceUrl('http://h', null, 'dashscope', 'translate')).toBe('http://h/chat/completions')
    expect(resolveServiceUrl('http://h', '/custom', 'dashscope', 'translate')).toBe('http://h/custom')
  })
})

describe('TTS 音色目录与 OpenAI 兼容探测（c070 单一出处）', () => {
  it('dashscope 与 mimo 目录各自完整；未知 provider 回落 dashscope', () => {
    expect(getTtsVoiceCatalog('dashscope').map((v) => v.id)).toEqual(['longanlingxin', 'longanlufeng'])
    expect(getTtsVoiceCatalog('mimo').map((v) => v.id)).toEqual(['Mia', 'Chloe', 'Milo', 'Dean'])
    expect(getTtsVoiceCatalog('qwen')).toEqual(getTtsVoiceCatalog('dashscope'))
  })

  it('isOpenAiCompatTts：显式 endpoint 优先，缺省按 provider 归一判断', () => {
    expect(isOpenAiCompatTts('mimo')).toBe(true)
    expect(isOpenAiCompatTts('custom-gw', '/chat/completions')).toBe(true)
    expect(isOpenAiCompatTts('custom-gw', '/v1/audio/speech')).toBe(false)
    expect(isOpenAiCompatTts('custom-gw')).toBe(false)
    expect(isOpenAiCompatTts('qwen')).toBe(false) // qwen → dashscope 非 mimo
  })
})
