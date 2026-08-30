/**
 * 生词助记服务 —— 调用 BFF /api/mnemonic 生成助记内容
 *
 * 调用链：客户端 → /api/mnemonic → lib/llm/mnemonic-service.ts → LangChain ChatOpenAI
 *
 * 所有方法直接调用 API，失败时抛出错误，不做 mock fallback。
 */

import type { Association, Exercises, MnemonicCard, MnemonicSseEvent, SentenceEvaluation } from '../../types/mnemonic'
import { throwIfAborted, type MnemonicService } from '../contracts'

// ---------------------------------------------------------------------------
// API 调用
// ---------------------------------------------------------------------------

async function callApi<T>(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch('/api/mnemonic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
    signal,
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data.error || `助记请求失败 (${res.status})`)
  }

  return data as T
}

// ---------------------------------------------------------------------------
// Service 实现
// ---------------------------------------------------------------------------

export interface MockMnemonicOptions {
  /** 保留接口兼容，不再使用 */
  latencyMs?: number
}

export class MockMnemonicService implements MnemonicService {
  constructor(_options: MockMnemonicOptions = {}) {}

  async generateCard(word: string, context: string, note?: string, signal?: AbortSignal): Promise<MnemonicCard> {
    throwIfAborted(signal)
    return callApi<MnemonicCard>('card', { word, context, note }, signal)
  }

  async *generateCardStream(word: string, context: string, note?: string, signal?: AbortSignal): AsyncGenerator<MnemonicSseEvent> {
    throwIfAborted(signal)

    const res = await fetch('/api/mnemonic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'card_stream', word, context, note }),
      signal,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      yield { event: 'error', data: { error: data.error || `助记请求失败 (${res.status})` } }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { event: 'error', data: { error: '无法读取流式响应' } }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6)
            try {
              const data = JSON.parse(jsonStr)
              yield { event: currentEvent as MnemonicSseEvent['event'], data } as MnemonicSseEvent
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async generateAssociation(word: string, meaning: string, signal?: AbortSignal): Promise<Association> {
    throwIfAborted(signal)
    return callApi<Association>('association', { word, meaning }, signal)
  }

  async generateExercises(
    word: string,
    meaning: string,
    collocations: string[],
    difficulty: string,
    signal?: AbortSignal,
  ): Promise<Exercises> {
    throwIfAborted(signal)
    return callApi<Exercises>('exercises', { word, meaning, collocations, difficulty }, signal)
  }

  async evaluateSentence(word: string, meaning: string, sentence: string, signal?: AbortSignal): Promise<SentenceEvaluation> {
    throwIfAborted(signal)
    return callApi<SentenceEvaluation>('evaluate', { word, meaning, sentence }, signal)
  }
}
