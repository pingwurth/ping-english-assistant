/**
 * HtmlPlayerController 单测 —— 覆盖 AGENTS.md 红线逻辑（不得移除的机制）：
 *  - §5.1 seek 落点校准状态机：pendingSeekMs 静默、首个原生 timeupdate 校准、
 *    >300ms 记为 seekDriftMs（≤300 归零）、2s 兜底超时（node 无 window，兜底不装填，
 *    状态机其余部分全覆盖）；
 *  - timeupdate 派发 100ms 节流（TIME_EMIT_INTERVAL_MS）与回跳立即派发；
 *  - play() 的 AbortError 吞噬范围（良性竞态）与 NotAllowedError → PLAY_BLOCKED 事件；
 *  - controller 级 A-B 循环越界回跳；destroy 解绑与卸载。
 *
 * 纯 node 运行：注入 fake 媒体元素（构造器第二参），不触碰 document/rAF/window。
 */
import { describe, expect, it, vi } from 'vitest'
import { HtmlPlayerController } from '../html-player'

/** 事件驱动的假媒体元素：dispatch(name) 模拟原生事件 */
class FakeMediaElement {
  private listeners = new Map<string, Set<EventListener>>()
  currentTimeSec = 0
  durationSec = Number.NaN
  playbackRate = 1
  volume = 1
  src = ''
  paused = true
  ended = false
  loadCalls = 0
  removedAttrs: string[] = []
  /** play() 的返回值（模拟被浏览器打断/拦截） */
  playResult: Promise<void> | undefined = undefined

  addEventListener(name: string, fn: EventListener): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(fn)
  }
  removeEventListener(name: string, fn: EventListener): void {
    this.listeners.get(name)?.delete(fn)
  }
  dispatch(name: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn({ type: name } as Event)
  }
  play(): Promise<void> | undefined {
    this.paused = false
    return this.playResult
  }
  pause(): void { this.paused = true }
  load(): void { this.loadCalls++ }
  removeAttribute(name: string): void { this.removedAttrs.push(name); if (name === 'src') this.src = '' }
  get currentTime(): number { return this.currentTimeSec }
  set currentTime(v: number) { this.currentTimeSec = v }
  get duration(): number { return this.durationSec }
  set duration(v: number) { this.durationSec = v }
}

function makeController(): { el: FakeMediaElement; c: HtmlPlayerController } {
  const el = new FakeMediaElement()
  const c = new HtmlPlayerController('audio', el as unknown as HTMLAudioElement)
  return { el, c }
}

describe('seek 落点校准（§5.1）', () => {
  it('seekTo 后进入待校准态；首个原生 timeupdate 按实际落点派发并解除', () => {
    const { el, c } = makeController()
    const times: number[] = []
    c.on('timeupdate', (ms) => times.push(ms))

    c.seekTo(3000)
    expect(c.isSeeking()).toBe(true)
    expect(el.currentTimeSec).toBe(3)

    // 实际落点 3.3s：校准派发 3300（不受节流影响，立即发出）
    el.currentTimeSec = 3.3
    el.dispatch('timeupdate')
    expect(c.isSeeking()).toBe(false)
    expect(times).toEqual([3300])
    expect(c.getCurrentTimeMs()).toBe(3300)
  })

  it('漂移 ≤300ms 归零上报', () => {
    const { el, c } = makeController()
    c.seekTo(3000)
    el.currentTimeSec = 3.3 // 漂移恰 300ms
    el.dispatch('timeupdate')
    expect(c.getSeekDriftMs()).toBe(0)
  })

  it('漂移 >300ms 上报正漂移量（供 SentencePlayer 修正循环边界容差）', () => {
    const { el, c } = makeController()
    c.seekTo(3000)
    el.currentTimeSec = 3.7 // 漂移 700ms（视频关键帧媒体的典型量级）
    el.dispatch('timeupdate')
    expect(c.getSeekDriftMs()).toBe(700)
  })
})

describe('timeupdate 派发节流（100ms 门控）', () => {
  it('前进按 100ms 节流；位置回跳（循环回跳后首个采样）立即派发', () => {
    const { el, c } = makeController()
    const times: number[] = []
    c.on('timeupdate', (ms) => times.push(ms))

    el.currentTimeSec = 0.05
    el.dispatch('timeupdate') // |50-0|<100：静默
    el.currentTimeSec = 0.15
    el.dispatch('timeupdate') // 派发 150
    el.currentTimeSec = 0.19
    el.dispatch('timeupdate') // 静默
    expect(times).toEqual([150])

    el.currentTimeSec = 0.0 // 回跳（|0-150|≥100）立即派发
    el.dispatch('timeupdate')
    expect(times).toEqual([150, 0])
  })
})

describe('controller 级 A-B 循环', () => {
  it('越界即回跳 startMs，且回跳后的进度按待校准 seek 处理', () => {
    const { el, c } = makeController()
    c.setLoop(1000, 2000)

    el.currentTimeSec = 2.1
    el.dispatch('timeupdate')
    expect(el.currentTimeSec).toBe(1) // 已回跳
    expect(c.isSeeking()).toBe(true) // 回跳是 seek：等待落点校准
    expect(c.getCurrentTimeMs()).toBe(2100) // 回跳前的采样已记录
  })

  it('endMs<=startMs 视为无效循环', () => {
    const { el, c } = makeController()
    c.setLoop(2000, 2000)
    el.currentTimeSec = 5
    el.dispatch('timeupdate')
    expect(el.currentTimeSec).toBe(5) // 未回跳
  })
})

describe('play() 的 AbortError 分类', () => {
  it('良性竞态 AbortError：resolve 静默，不上报 PLAY_BLOCKED', async () => {
    const { el, c } = makeController()
    const errors: unknown[] = []
    c.on('error', (e) => errors.push(e))
    el.playResult = Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' }))

    await expect(c.play()).resolves.toBeUndefined()
    expect(errors).toHaveLength(0)
  })

  it('NotAllowedError 等拦截：走 error 事件通道（PLAY_BLOCKED），promise 仍 resolve', async () => {
    const { el, c } = makeController()
    const errors: Array<{ code: string; message: string }> = []
    c.on('error', (e) => errors.push(e))
    el.playResult = Promise.reject(Object.assign(new Error('autoplay denied'), { name: 'NotAllowedError' }))

    await expect(c.play()).resolves.toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.code).toBe('PLAY_BLOCKED')
    expect(errors[0]!.message).toContain('autoplay')
  })
})

describe('load / 状态机 / destroy', () => {
  it('load：loading → loadedmetadata → ready，duration 从元素读取', async () => {
    const { el, c } = makeController()
    const states: string[] = []
    c.on('statechange', (s) => states.push(s))
    el.durationSec = 90

    const loaded = c.load({ type: 'audio', src: 'blob:x' })
    expect(states).toContain('loading')
    el.dispatch('loadedmetadata')
    await loaded
    expect(c.getState()).toBe('ready')
    expect(c.getDurationMs()).toBe(90_000)
    expect(el.src).toBe('blob:x')
    expect(el.loadCalls).toBe(1)
  })

  it('播放事件驱动状态机', () => {
    const { el, c } = makeController()
    const states: string[] = []
    c.on('statechange', (s) => states.push(s))

    el.dispatch('play')
    expect(c.getState()).toBe('playing')
    el.dispatch('pause')
    expect(c.getState()).toBe('paused')
    el.dispatch('ended')
    expect(c.getState()).toBe('ended')
  })

  it('destroy：解绑全部监听、暂停并卸载 src；重复 destroy 幂等', () => {
    const { el, c } = makeController()
    const spy = vi.fn()
    c.on('timeupdate', spy)

    c.destroy()
    c.destroy()
    el.dispatch('timeupdate')
    expect(spy).not.toHaveBeenCalled()

    expect(el.paused).toBe(true)
    expect(el.removedAttrs).toContain('src')
    expect(el.loadCalls).toBeGreaterThanOrEqual(1) // 卸载 src 后 load() 中断下载
  })

  it('destroy 后 play 不再触碰元素且 reject', async () => {
    const { el, c } = makeController()
    c.destroy()
    el.playResult = undefined
    await expect(c.play()).rejects.toThrow('destroyed')
    expect(el.paused).toBe(true)
  })
})
