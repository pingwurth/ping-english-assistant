/**
 * 生词助记服务 —— 调用 BFF /api/mnemonic 生成助记内容
 *
 * 调用链：客户端 → /api/mnemonic → lib/llm/mnemonic-service.ts → LangChain ChatOpenAI
 *
 * 所有方法直接调用 API，失败时抛出错误，不做 mock fallback。
 */

import type { Association, Exercises, MnemonicCard, MnemonicSseEvent, SentenceEvaluation } from '../../types/mnemonic'
import { toApiError, throwIfAborted, type MnemonicService } from '../contracts'

// ---------------------------------------------------------------------------
// API 调用
// ---------------------------------------------------------------------------

/** 调 BFF 并归一错误（契约：失败统一抛 ApiError，含中止 code 'ABORTED'） */
async function callApi<T>(action: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch('/api/mnemonic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
      signal,
    })
  } catch (err) {
    throw toApiError(err)
  }

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw toApiError(new Error(data.error || `助记请求失败 (${res.status})`))
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
    // 事件名必须跨网络块存活：'event:' 行与 'data:' 行可能被 TCP 分段切进
    // 两次 reader.read()，若每个块重置会产出 event:'' 的事件被消费方丢弃。
    let currentEvent = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

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
            currentEvent = '' // data 已消费该事件，防止后续无 event 行的数据误挂旧名
          } else if (line.trim() === '') {
            currentEvent = '' // 事件以空行分帧，帧结束即重置
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
