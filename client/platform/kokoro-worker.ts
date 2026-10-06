/**
 * Kokoro 推理 Worker —— ONNX 推理跑在这里，主线程因此不会被阻塞。
 *
 * 背景：onnxruntime 的 WASM 推理是同步计算，放在主线程会让页面在每句推理期间
 * 完全卡死（约 6-7 秒/句，Chrome 会弹 "Page Unresponsive"），连取消按钮都点不动。
 * 挪到 worker 后主线程只负责 UI，取消按钮立刻响应。
 *
 * 模型与音色统一经本地代理（/api/hf/）加载，由代理读写磁盘缓存
 * （~/.ping-eng/kokoro-models/，路径见设置里的 kokoro.modelPath）。
 */

import type { KokoroTTS } from 'kokoro-js'
import { splitTtsSentences, type TtsSentenceTiming } from '@/services/mock/tts'
import type {
  KokoroSynthesisResult,
  KokoroWorkerRequest,
  KokoroWorkerResponse,
} from './kokoro-protocol'

/** 量化档位；q8 对应仓库里的 onnx/model_quantized.onnx */
const KOKORO_DTYPE = 'q8' as const
/** 权重文件名，由 KOKORO_DTYPE 决定（transformers.js 的 dtype 后缀映射）。也是最大的那个文件 */
const MODEL_ONNX_FILE = 'onnx/model_quantized.onnx'
/** kokoro-js 自带的浏览器音色缓存名。弃用它，让磁盘缓存成为唯一真源 */
const KOKORO_VOICE_CACHE = 'kokoro-voices'
/** huggingface.co 上的模型文件地址；kokoro-js 内部硬编码的音色地址就是这个形状 */
const HF_RESOLVE_RE = /^https:\/\/huggingface\.co\/(.+\/resolve\/[^/]+\/.+)$/
/** 句间静音（与云端路径的 buildTtsTimeline 估算口径一致） */
const INTER_SENTENCE_GAP_MS = 120

/** Kokoro 音色 ID 联合类型（推导自 kokoro-js generate 选项） */
type KokoroVoiceId = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

const voicesFileOf = (voice: string) => `voices/${voice}.bin`

/**
 * Worker 全局。这里故意只声明用得到的那几个成员，而不是引入 lib.webworker ——
 * 那会和 tsconfig 里的 dom lib 冲突（self / postMessage 签名不一致）。
 */
interface WorkerScope {
  postMessage(message: KokoroWorkerResponse, transfer?: Transferable[]): void
  location: { origin: string }
  fetch: typeof fetch
  addEventListener(type: 'message', listener: (e: MessageEvent<KokoroWorkerRequest>) => void): void
}

const ctx = self as unknown as WorkerScope

function post(message: KokoroWorkerResponse, transfer?: Transferable[]): void {
  ctx.postMessage(message, transfer)
}

let modelId = ''
let instance: KokoroTTS | null = null
let loading: Promise<KokoroTTS> | null = null
let envConfigured = false

/**
 * 已收到取消请求、但可能还在跑当前句的生成 id。
 * 用 Set 而不是单个布尔值：取消可能晚于下一次生成到达。
 */
const canceled = new Set<number>()

/**
 * kokoro-js 取音色时把地址硬编码成 https://huggingface.co/...（见 dist/kokoro.js），
 * 绕过了 env.remoteHost —— 音色因此既走不到代理，也存不进 ~/.ping-eng。
 * 这里把指向 huggingface.co 的模型文件请求统一改写到本地代理。
 */
function installHfProxy(): void {
  const originalFetch = ctx.fetch.bind(self)

  const rewritten = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.href : input.url
    const matched = HF_RESOLVE_RE.exec(url)
    if (!matched) return originalFetch(input, init)

    const local = `${ctx.location.origin}/api/hf/${matched[1]}`
    return input instanceof Request
      ? originalFetch(new Request(local, input), init)
      : originalFetch(local, init)
  }

  ctx.fetch = async (input, init) => {
    const res = await rewritten(input, init)
    // kokoro-js 不检查 response.ok，会把错误响应体直接喂给 new Float32Array()，
    // 最后报出「byte length of Float32Array should be a multiple of 4」这种
    // 和真实原因（上游下载失败）毫无关系的错。这里让失败真的失败。
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`模型文件下载失败（HTTP ${res.status}）${detail.slice(0, 200)}`)
    }
    return res
  }
}

/** 把模型请求指向本地代理，并清掉浏览器侧的副本缓存 */
async function configureEnv(): Promise<void> {
  if (envConfigured) return
  envConfigured = true

  const { env } = await import('@huggingface/transformers')
  // 模型文件读写全部交给 /api/hf/ 代理 → 落盘到 kokoro.modelPath
  env.remoteHost = `${ctx.location.origin}/api/hf/`
  // 关掉 transformers.js 的 Cache Storage 缓存：否则同一份模型在浏览器和磁盘各存一份，
  // 而且无法判断这次到底是读了缓存还是真的下载了
  env.useBrowserCache = false

  installHfProxy()

  // kokoro-js 还会把音色写进自己的 Cache Storage，同样弃用
  try {
    await caches.delete(KOKORO_VOICE_CACHE)
  } catch {
    // 无 Cache API 时（受限上下文）忽略：kokoro-js 自己会降级为不缓存
  }
}

/**
 * 探测文件是否已在磁盘缓存中。
 * 走 HEAD：代理只查磁盘、不触发任何上游下载，可以安全地在加载前调用。
 */
async function isCachedOnDisk(file: string): Promise<boolean> {
  try {
    const res = await ctx.fetch(`${ctx.location.origin}/api/hf/${modelId}/resolve/main/${file}`, {
      method: 'HEAD',
      cache: 'no-store',
    })
    return res.ok && res.headers.get('x-cache') === 'HIT'
  } catch {
    return false
  }
}

/** 加载模型（幂等，模型常驻 worker） */
function loadModel(): Promise<KokoroTTS> {
  if (instance) return Promise.resolve(instance)
  if (loading) return loading

  loading = (async () => {
    await configureEnv()

    // 先查磁盘：命中就是「读缓存」，未命中才是真下载 —— 事件如实反映这一点
    const cached = await isCachedOnDisk(MODEL_ONNX_FILE)
    post({ type: 'load', event: { phase: cached ? 'loading' : 'downloading' } })

    const { KokoroTTS } = await import('kokoro-js')
    instance = await KokoroTTS.from_pretrained(modelId, {
      dtype: KOKORO_DTYPE,
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress') {
          // 读缓存时 transformers.js 也会逐块报 progress（它按流式读取算百分比），
          // 那不是下载，所以只在真正下载时把百分比透出去
          post({
            type: 'load',
            event: {
              phase: cached ? 'loading' : 'downloading',
              file: p.file,
              percent: cached ? undefined : p.progress,
            },
          })
        } else if (p.status === 'initiate' || p.status === 'download') {
          post({ type: 'load', event: { phase: cached ? 'loading' : 'downloading', file: p.file } })
        } else if (p.status === 'done' && p.file === MODEL_ONNX_FILE) {
          // 权重就位，剩下的时间花在建 ONNX 会话上
          post({ type: 'load', event: { phase: 'initializing' } })
        }
      },
    })
    post({ type: 'load', event: null })
    return instance
  })().catch((err) => {
    loading = null
    instance = null
    post({ type: 'load', event: null })
    throw err
  })

  return loading
}

async function handleGenerate(
  req: Extract<KokoroWorkerRequest, { type: 'generate' }>,
): Promise<void> {
  const { id, text, voice, speed } = req
  try {
    const tts = await loadModel()
    // delete 即「消费掉」取消标记
    if (canceled.delete(id)) {
      post({ type: 'aborted', id })
      return
    }

    // 音色同样缓存在磁盘上，只有第一次用某个音色时才需要下载
    const voiceFile = voicesFileOf(voice)
    if (!(await isCachedOnDisk(voiceFile))) {
      post({ type: 'load', event: { phase: 'downloading', file: voiceFile } })
    }
    if (canceled.delete(id)) {
      post({ type: 'aborted', id })
      return
    }

    const sentences = splitTtsSentences(text)
    if (sentences.length === 0) throw new Error('文本为空，无法合成语音')

    const timings: TtsSentenceTiming[] = []
    const chunks: Float32Array[] = []
    let sampleRate = 24000
    let cursorMs = 0

    for (let i = 0; i < sentences.length; i++) {
      // 取消只在句与句之间生效：单句推理是同步的、无法中断。
      // 但主线程早已先返回，所以用户看到的取消是立刻响应的。
      if (canceled.delete(id)) {
        post({ type: 'aborted', id })
        return
      }

      const raw = await tts.generate(sentences[i]!, { voice: voice as KokoroVoiceId, speed })
      sampleRate = raw.sampling_rate
      const durMs = Math.round((raw.audio.length / sampleRate) * 1000)
      timings.push({ index: i, text: sentences[i]!, startMs: cursorMs, endMs: cursorMs + durMs })
      chunks.push(raw.audio)
      cursorMs += durMs
      if (i < sentences.length - 1) {
        chunks.push(new Float32Array(Math.round((INTER_SENTENCE_GAP_MS / 1000) * sampleRate)))
        cursorMs += INTER_SENTENCE_GAP_MS
      }
      post({ type: 'progress', id, done: i + 1, total: sentences.length })
    }

    // 拼接放在 worker 里做，主线程只拿最终 buffer（transfer 零拷贝）
    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const c of chunks) {
      samples.set(c, offset)
      offset += c.length
    }

    canceled.delete(id)
    const result: KokoroSynthesisResult = { sampleRate, samples, durationMs: cursorMs, timings }
    post({ type: 'done', id, result }, [samples.buffer])
  } catch (err) {
    canceled.delete(id)
    post({ type: 'error', id, message: err instanceof Error ? err.message : '合成失败' })
  }
}

ctx.addEventListener('message', (e) => {
  const req = e.data
  switch (req.type) {
    case 'init':
      modelId = req.modelId
      loadModel().catch((err) => {
        post({
          type: 'error',
          id: null,
          message: err instanceof Error ? err.message : 'Kokoro 模型加载失败',
        })
      })
      break
    case 'generate':
      // 不 await：让 worker 的事件循环空出来接收后续的 cancel 消息
      void handleGenerate(req)
      break
    case 'cancel':
      canceled.add(req.id)
      break
  }
})