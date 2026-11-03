/**
 * LLM 错误归一与状态码映射回归（2026-11 全仓复审 #4/#9）：
 *  - AbortSignal.timeout 的 TimeoutError（不是 AbortError）必须归一为
 *    REQUEST_TIMEOUT → 504，此前 504 映射是死码、超时被误报成 500；
 *  - ABORTED（取消）不得落进 ?? 502 兜底被报成「服务故障」→ 499；
 *  - PROVIDER_NOT_SUPPORTED → 400。
 */
import { describe, expect, it } from 'vitest'
import { ApiError, toApiError } from '@/services/contracts'
import { LlmError, toLlmError, toLlmErrorResponse } from '../errors'

function domException(name: string): DOMException {
  return new DOMException('synthetic', name)
}

describe('toApiError 超时/取消归一（复审 #4）', () => {
  it('TimeoutError → REQUEST_TIMEOUT（AbortSignal.timeout 的 abort reason）', () => {
    const err = toApiError(domException('TimeoutError'))
    expect(err.code).toBe('REQUEST_TIMEOUT')
  })

  it('AbortError 仍归 ABORTED，不被 TimeoutError 分支误吞', () => {
    const err = toApiError(domException('AbortError'))
    expect(err.code).toBe('ABORTED')
  })

  it('fetch failed 仍归 NETWORK_ERROR', () => {
    const err = toApiError(new Error('fetch failed'))
    expect(err.code).toBe('NETWORK_ERROR')
  })
})

describe('toLlmError 保留超时语义（复审 #4）', () => {
  it('TimeoutError → LlmError(REQUEST_TIMEOUT) 而非 UPSTREAM_ERROR', () => {
    const err = toLlmError(domException('TimeoutError'))
    expect(err).toBeInstanceOf(LlmError)
    expect(err.code).toBe('REQUEST_TIMEOUT')
  })

  it('已是 LlmError 的错误原样透传', () => {
    const origin = new LlmError('MODEL_NOT_CONFIGURED', '未配置')
    expect(toLlmError(origin)).toBe(origin)
  })
})

describe('toLlmErrorResponse 状态码映射（复审 #4/#9）', () => {
  const cases: Array<[string, number]> = [
    ['REQUEST_TIMEOUT', 504],
    ['ABORTED', 499],
    ['PROVIDER_NOT_SUPPORTED', 400],
    ['MODEL_NOT_CONFIGURED', 400],
    ['UPSTREAM_ERROR', 502],
  ]
  it.each(cases)('%s → %i', (code, status) => {
    const res = toLlmErrorResponse(new LlmError(code as never, 'x'))
    expect(res.status).toBe(status)
  })

  it('TimeoutError 经 toApiError + toLlmError 升级后同样落 504', async () => {
    const res = toLlmErrorResponse(toLlmError(toApiError(domException('TimeoutError'))))
    expect(res.status).toBe(504)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('REQUEST_TIMEOUT')
  })
})

/** 防止 ApiError 构造签名变化时上面用例静默失真 */
it('ApiError 携带 code/detail 的统一信封形状', () => {
  const err = new ApiError('ABORTED', '操作已取消', { a: 1 })
  expect(err.code).toBe('ABORTED')
  expect(err.detail).toEqual({ a: 1 })
})
