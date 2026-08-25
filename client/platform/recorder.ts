/**
 * RecorderController（H5/Web 实现）—— 真源：docs/系统架构设计.md §2.3
 *
 * 链路：getUserMedia({audio:{echoCancellation:true}}) → MediaRecorder 采集
 *   → AnalyserNode RMS 音量回调（节流至约 30fps，驱动录音按钮声波动画，原型设计 §5.3）
 *   → stop() 后经 AudioContext.decodeAudioData → OfflineAudioContext 重采样为
 *     16kHz 单声道（ADR-5）→ wav-encoder 输出 RecordedAudio { blob, durationMs, sampleRate }。
 *
 * 错误类型可识别（供 UI 渲染引导浮层，原型设计 §6.3"麦克风权限拒绝 → 浮层说明 + [去设置]"）：
 *   - RecorderPermissionError：权限被拒/无麦克风设备
 *   - RecorderNotStartedError：未开始即调用 pause/resume/stop
 *   - RecorderError：其他（浏览器不支持、解码失败等）
 *
 * 资源纪律：编码完成立即 close() AudioContext、stop 并释放全部 MediaStreamTrack、
 * 取消 rAF/定时器、断开节点引用并置空 AudioBuffer。
 *
 * 已知限制（原型范围）：pause/resume 保留原始时间轴，解码结果含暂停间隔
 * （真实实现对齐架构 §2.3 的 Recorder.js 方案，可精确剔除静音段）。
 */

import { encodeWav, TARGET_SAMPLE_RATE, WAV_MIME } from '../core/audio/wav-encoder'

/** §2.3 RecordOptions（H5 原型默认上限 60s；小程序硬上限 10 分钟见架构文档） */
export interface RecordOptions {
  format: 'pcm' | 'wav'
  sampleRate: number
  channels: number
  maxDurationMs: number
}

/** §2.3 RecordedAudio（H5 为 Blob） */
export interface RecordedAudio {
  blob: Blob
  durationMs: number
  sampleRate: number
}

/** §2.3 RecorderEvents */
export interface RecorderEvents {
  /** RMS 音量 0-1，节流至约 30fps，驱动声波动画 */
  volume: (level: number) => void
  /** 到达 maxDurationMs 上限自动停止 */
  maxreach: () => void
  error: (err: RecorderError) => void
}

/* ── 可识别错误类型 ── */

/** 录音模块错误基类 */
export class RecorderError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'RecorderError'
  }
}

/** 麦克风权限被拒或无可用设备 —— UI 应渲染权限引导浮层（原型设计 §6.3） */
export class RecorderPermissionError extends RecorderError {
  constructor(message = '麦克风权限被拒绝或无可用麦克风设备', cause?: unknown) {
    super(message, cause)
    this.name = 'RecorderPermissionError'
  }
}

/** 未开始录音即调用 pause/resume/stop */
export class RecorderNotStartedError extends RecorderError {
  constructor(message = '录音尚未开始') {
    super(message)
    this.name = 'RecorderNotStartedError'
  }
}

/** 音量采样节流间隔（约 30fps） */
const VOLUME_INTERVAL_MS = 33
/** stop() 后等待 MediaRecorder 尾片落盘的缓冲时间 */
const DRAIN_MS = 60
/** 默认时长上限（任务约定 60s；架构 §2.3 小程序硬上限 10 分钟由各自适配器处理） */
const DEFAULT_MAX_DURATION_MS = 60000

const AUDIO_CTX_CTOR: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

/** §2.3 RecorderController 的 H5/Web 实现 */
export class WebRecorder {
  private state: RecorderState = 'idle'
  private options: RecordOptions = {
    format: 'wav',
    sampleRate: TARGET_SAMPLE_RATE,
    channels: 1,
    maxDurationMs: DEFAULT_MAX_DURATION_MS,
  }
  private stream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioCtx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private volumeTimer: number | null = null
  private maxTimer: number | null = null
  private startedAt = 0
  private elapsedMs = 0
  private listeners: { [E in keyof RecorderEvents]?: Set<RecorderEvents[E]> } = {}

  /** §2.3 start(options?)：申请麦克风权限并开始录音 */
  async start(options?: Partial<RecordOptions>): Promise<void> {
    if (this.state === 'recording' || this.state === 'paused') {
      throw new RecorderError('录音已在进行中，请先 stop/cancel')
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new RecorderError('当前环境不支持录音（缺少 getUserMedia/MediaRecorder）')
    }
    this.options = { ...this.options, ...options }
    this.cleanupTimers()
    this.chunks = []
    this.elapsedMs = 0

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } })
    } catch (err) {
      const e = err as { name?: string }
      const denied =
        e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError' || e?.name === 'SecurityError'
      const failure = new RecorderPermissionError(
        denied ? '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风' : '未检测到可用的麦克风设备',
        err,
      )
      this.emit('error', failure)
      throw failure
    }

    try {
      this.audioCtx = new AUDIO_CTX_CTOR!()
      this.source = this.audioCtx.createMediaStreamSource(this.stream)
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.source.connect(this.analyser)

      this.mediaRecorder = new MediaRecorder(this.stream)
      this.mediaRecorder.ondataavailable = (ev: BlobEvent) => {
        if (ev.data && ev.data.size > 0) this.chunks.push(ev.data)
      }
      this.mediaRecorder.start(250) // timeslice：保证尾片及时落盘

      this.state = 'recording'
      this.startedAt = Date.now()
      this.startVolumeLoop()
      this.maxTimer = window.setTimeout(() => void this.autoStop(), this.options.maxDurationMs)
    } catch (err) {
      this.teardownMedia()
      const failure = new RecorderError('录音初始化失败', err)
      this.emit('error', failure)
      throw failure
    }
  }

  /** §2.3 pause()（影子跟读/背诵可暂停） */
  pause(): void {
    if (this.state !== 'recording' || !this.mediaRecorder) throw new RecorderNotStartedError()
    this.elapsedMs += Date.now() - this.startedAt
    this.mediaRecorder.pause()
    this.cleanupTimers()
    this.state = 'paused'
  }

  /** §2.3 resume() */
  resume(): void {
    if (this.state !== 'paused' || !this.mediaRecorder) throw new RecorderNotStartedError()
    this.mediaRecorder.resume()
    this.startedAt = Date.now()
    this.startVolumeLoop()
    const remaining = this.options.maxDurationMs - this.elapsedMs
    this.maxTimer = window.setTimeout(() => void this.autoStop(), Math.max(remaining, 1))
    this.state = 'recording'
  }

  /**
   * §2.3 stop()：停止采集 → 解码 → 重采样 16kHz 单声道 → WAV Blob。
   * 编码完成后立即释放全部媒体资源。
   */
  async stop(): Promise<RecordedAudio> {
    if ((this.state !== 'recording' && this.state !== 'paused') || !this.mediaRecorder) {
      throw new RecorderNotStartedError()
    }
    if (this.state === 'recording') this.elapsedMs += Date.now() - this.startedAt
    this.state = 'stopped'
    this.cleanupTimers()

    const recorder = this.mediaRecorder
    const drained = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve()
    })
    await drained
    // 等待 timeslice 尾片全部派发到 ondataavailable
    await new Promise<void>((resolve) => setTimeout(resolve, DRAIN_MS))

    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' })
    this.teardownMedia()
    try {
      return await this.process(blob)
    } catch (err) {
      const failure = err instanceof RecorderError ? err : new RecorderError('录音解码/编码失败', err)
      this.emit('error', failure)
      throw failure
    }
  }

  /** §2.3 cancel()：丢弃录音并释放资源 */
  cancel(): void {
    this.cleanupTimers()
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop()
      } catch {
        /* 已停止则忽略 */
      }
    }
    this.teardownMedia()
    this.chunks = []
    this.state = 'idle'
  }

  /** §2.3 on(event, cb) */
  on<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void {
    const sets = this.listeners as Record<E, Set<RecorderEvents[E]> | undefined>
    const set = sets[event] ?? new Set<RecorderEvents[E]>()
    set.add(cb)
    sets[event] = set
  }

  /** 取消事件订阅（配套 on 使用） */
  off<E extends keyof RecorderEvents>(event: E, cb: RecorderEvents[E]): void {
    ;(this.listeners as Record<E, Set<RecorderEvents[E]> | undefined>)[event]?.delete(cb)
  }

  /** §2.3 destroy()：终止并释放一切（组件卸载时调用） */
  destroy(): void {
    this.cancel()
    this.listeners = {}
  }

  /** 当前状态（供 UI 渲染录音按钮态，原型设计 §5.3） */
  getState(): RecorderState {
    return this.state
  }

  /** 已录时长（ms，不含暂停间隔） */
  getElapsedMs(): number {
    if (this.state === 'recording') return this.elapsedMs + (Date.now() - this.startedAt)
    return this.elapsedMs
  }

  /* ── 内部实现 ── */

  private emit<E extends keyof RecorderEvents>(event: E, ...args: Parameters<RecorderEvents[E]>): void {
    const set = (this.listeners as Record<E, Set<RecorderEvents[E]> | undefined>)[event]
    set?.forEach((cb) => {
      try {
        ;(cb as (...a: Parameters<RecorderEvents[E]>) => void)(...args)
      } catch {
        /* 监听器异常不影响录音主流程 */
      }
    })
  }

  /** RMS 音量循环：AnalyserNode 时域数据 → RMS（0-1），节流至约 30fps */
  private startVolumeLoop(): void {
    const analyser = this.analyser
    if (!analyser) return
    const buf = new Float32Array(analyser.fftSize)
    let last = 0
    const loop = (now: number) => {
      if (this.state !== 'recording') return
      this.volumeTimer = requestAnimationFrame(loop)
      if (now - last < VOLUME_INTERVAL_MS) return
      last = now
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      this.emit('volume', Math.min(1, rms * Math.SQRT2))
    }
    this.volumeTimer = requestAnimationFrame(loop)
  }

  private cleanupTimers(): void {
    if (this.volumeTimer !== null) {
      cancelAnimationFrame(this.volumeTimer)
      this.volumeTimer = null
    }
    if (this.maxTimer !== null) {
      clearTimeout(this.maxTimer)
      this.maxTimer = null
    }
  }

  /** 到达 maxDurationMs：派发 maxreach 后自动 stop（§2.3 RecorderEvents.maxreach） */
  private async autoStop(): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'paused') return
    this.emit('maxreach')
    try {
      await this.stop()
    } catch {
      /* stop 内部已派发 error 事件 */
    }
  }

  /** 停止并释放全部媒体资源（track/AudioContext/节点引用置空） */
  private teardownMedia(): void {
    this.cleanupTimers()
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        /* ignore */
      }
      this.source = null
    }
    this.analyser?.disconnect()
    this.analyser = null
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    this.mediaRecorder = null
  }

  /** 解码 → OfflineAudioContext 重采样 16kHz 单声道 → WAV Blob（ADR-5） */
  private async process(blob: Blob): Promise<RecordedAudio> {
    if (blob.size === 0) throw new RecorderError('录音内容为空')
    const decodeCtx = AUDIO_CTX_CTOR ? new AUDIO_CTX_CTOR() : null
    if (!decodeCtx) throw new RecorderError('当前环境不支持音频解码（AudioContext）')
    let raw: AudioBuffer
    try {
      raw = await decodeCtx.decodeAudioData(await blob.arrayBuffer())
    } finally {
      // 资源纪律：解码上下文立即关闭
      void decodeCtx.close().catch(() => {})
    }

    // OfflineAudioContext 构造时即混音为单声道
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(raw.duration * TARGET_SAMPLE_RATE)), TARGET_SAMPLE_RATE)
    const src = offline.createBufferSource()
    src.buffer = raw
    src.connect(offline.destination)
    src.start(0)
    const rendered = await offline.startRendering()
    const samples = rendered.getChannelData(0)
    const durationMs = Math.round(rendered.duration * 1000)
    const wav = encodeWav(samples, TARGET_SAMPLE_RATE)

    // 资源纪律：置空 AudioBuffer 引用，帮助 GC 回收
    src.buffer = null
    return { blob: new Blob([wav], { type: WAV_MIME }), durationMs, sampleRate: TARGET_SAMPLE_RATE }
  }
}

/** §2.3 工厂：创建 RecorderController（当前原型仅 H5/Web 一种实现） */
export function createRecorder(): WebRecorder {
  return new WebRecorder()
}
