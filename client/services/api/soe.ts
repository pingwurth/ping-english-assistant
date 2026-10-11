/** 真实 SOE 服务：POST {baseUrl}/api/v1/soe/evaluate（multipart：audio/refText/evalMode/provider） */
import { ApiError } from '../contracts'
import { buildServiceUrl } from '@/lib/service-endpoints'
import type { SoeEvalMode, SoeService } from '../contracts'
import type { SoeEvaluateResponse } from '../../types/api'

export class ApiSoeService implements SoeService {
  constructor(private readonly opts: { baseUrl: string; provider?: string }) {}

  async evaluate(audio: Blob, refText: string, evalMode: SoeEvalMode, signal?: AbortSignal): Promise<SoeEvaluateResponse> {
    const form = new FormData()
    form.append('audio', audio, 'audio.wav')
    form.append('refText', refText)
    form.append('evalMode', evalMode)
    if (this.opts.provider && this.opts.provider !== 'mock') form.append('provider', this.opts.provider)
    let res: Response
    try {
      res = await fetch(buildServiceUrl(this.opts.baseUrl, '/api/v1/soe/evaluate'), { method: 'POST', body: form, signal })
    } catch (err) {
      // 中止 → 契约 'ABORTED'（read-aloud 的静默分支依赖该 code）
      if (signal?.aborted) throw new ApiError('ABORTED', '操作已取消', err)
      throw new ApiError('SOE_UPSTREAM_ERROR', '评分服务不可达，请检查代理地址', err)
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string; detail?: unknown } | null
      throw new ApiError(body?.code ?? 'SOE_UPSTREAM_ERROR', body?.message ?? `评分请求失败（HTTP ${res.status}）`, body?.detail)
    }
    return (await res.json()) as SoeEvaluateResponse
  }
}
