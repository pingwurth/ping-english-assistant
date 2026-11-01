/**
 * WebRecorder 单测 —— node 环境注入 getUserMedia/MediaRecorder/AudioContext 假件。
 * 重点回归：start() 在权限弹窗期间（getUserMedia 未决）的二次调用必须被
 * 'starting' 态守卫拦下 —— 否则双份 MediaStream/AudioContext 建立后旧引用被
 * 覆盖，活麦克风 track 与 AudioContext 泄漏到页面刷新。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

/** 每次 reset 后重导入 recorder 模块（AUDIO_CTX_CTOR 在模块顶层读 window） */
async function importRecorder() {
  vi.resetModules()
  return await import('../recorder')
}

class FakeMediaRecorder {
  state = 'inactive'
  ondataavailable: ((ev: unknown) => void) | null = null
  onstop: (() => void) | null = null
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.onstop?.() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('start() 并发守卫', () => {
  it('权限弹窗期间的二次 start() 被拒，getUserMedia 只调一次；首次失败后状态回 idle', async () => {
    const pending = deferred<MediaStream>()
    const gum = vi.fn(() => pending.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const { createRecorder } = await importRecorder()
    const rec = createRecorder()

    const first = rec.start()
    // first 仍卡在 await getUserMedia（权限弹窗）——此时快速二次点击录音按钮
    await expect(rec.start()).rejects.toThrow('录音已在进行中')
    expect(gum).toHaveBeenCalledTimes(1) // 守卫生效：没有第二份 MediaStream

    // 放行第一个：本环境无 window.AudioContext → 初始化失败路径
    pending.resolve({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream)
    await expect(first).rejects.toThrow('录音初始化失败')
    expect(rec.getState()).toBe('idle') // 失败收尾后可重试
  })

  it('成功路径：recording 态下二次 start 仍被拒（原有守卫不回归）；cancel 释放 mic track', async () => {
    const track = { stop: vi.fn() }
    const okStream = { getTracks: () => [track] } as unknown as MediaStream
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve(okStream) } })

    class FakeAnalyser { fftSize = 0; disconnect() {} getFloatTimeDomainData() {} }
    class FakeSource { connect() {} disconnect() {} }
    class FakeAudioCtx {
      createMediaStreamSource() { return new FakeSource() }
      createAnalyser() { return new FakeAnalyser() }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('window', {
      AudioContext: FakeAudioCtx,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)

    const { createRecorder } = await importRecorder()
    const rec = createRecorder()
    await rec.start()
    expect(rec.getState()).toBe('recording')

    await expect(rec.start()).rejects.toThrow('录音已在进行中')

    rec.cancel()
    expect(rec.getState()).toBe('idle')
    expect(track.stop).toHaveBeenCalled() // 麦克风 track 已释放，指示灯不残留
  })
})

describe('start() 失败路径', () => {
  it('权限被拒 → RecorderPermissionError + error 事件，状态回 idle 可重试', async () => {
    const denied = Object.assign(new Error('The user did not grant permission'), { name: 'NotAllowedError' })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.reject(denied) } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const { createRecorder, RecorderPermissionError } = await importRecorder()

    const rec = createRecorder()
    const errors: unknown[] = []
    rec.on('error', (e) => errors.push(e))

    await expect(rec.start()).rejects.toBeInstanceOf(RecorderPermissionError)
    expect(errors).toHaveLength(1)
    expect(rec.getState()).toBe('idle')
  })

  it('环境不支持（无 getUserMedia）→ RecorderError，不触发权限申请', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} })
    const { createRecorder } = await importRecorder()
    const rec = createRecorder()
    await expect(rec.start()).rejects.toThrow('当前环境不支持录音')
    expect(rec.getState()).toBe('idle')
  })
})
