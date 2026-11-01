/**
 * SentencePlayer 单测 —— 头注释承诺的「注入 fake PlayerController 直接单测」。
 * 重点覆盖无护栏时最险的分支：A-B 循环三档次数与 ±120ms 容差、漂移补偿边界、
 * open-ended 句守卫、playRange 停点、setSentences 保态/重置语义（e54694f 依赖）。
 */
import { describe, expect, it, vi } from 'vitest'
import { SentencePlayer, LOOP_TOLERANCE_MS, type SentenceRange } from '../sentence-player'
import type { PlayerController, PlayerState } from '../types'

/** 记录调用的 fake 控制器：tick() 模拟一次 timeupdate 回调 */
class FakeController implements PlayerController {
  state: PlayerState = 'idle'
  currentTimeMs = 0
  durationMs = 60_000
  rate = 1
  volume = 1
  seekCalls: number[] = []
  playCalls = 0
  pauseCalls = 0
  clearLoopCalls = 0
  destroyed = 0
  /** 模拟 §5.1 seek 落点漂移（大漂移媒体） */
  driftMs = 0
  private handlers: { [E in keyof import('../types').PlayerEvents]: Set<any> } = {
    timeupdate: new Set(),
    statechange: new Set(),
    ended: new Set(),
    error: new Set(),
  }

  load() { return Promise.resolve() }
  async play() { this.playCalls++ }
  pause() { this.pauseCalls++ }
  seekTo(ms: number) { this.seekCalls.push(ms); this.currentTimeMs = ms }
  setRate(r: number) { this.rate = r }
  setVolume(v: number) { this.volume = v }
  setLoop() { /* controller 级循环不由本层测试 */ }
  clearLoop() { this.clearLoopCalls++ }
  getCurrentTimeMs() { return this.currentTimeMs }
  getDurationMs() { return this.durationMs }
  getState() { return this.state }
  getSeekDriftMs() { return this.driftMs }
  on<E extends keyof import('../types').PlayerEvents>(event: E, cb: any) { this.handlers[event].add(cb) }
  off<E extends keyof import('../types').PlayerEvents>(event: E, cb: any) { this.handlers[event].delete(cb) }
  destroy() { this.destroyed++ }

  /** 驱动一次 timeupdate（同时更新内部时钟） */
  tick(ms: number): void {
    this.currentTimeMs = ms
    for (const cb of this.handlers.timeupdate) cb(ms)
  }
  end(): void {
    for (const cb of this.handlers.ended) cb()
  }
}

const S: SentenceRange[] = [
  { startMs: 0, endMs: 2000 },
  { startMs: 2000, endMs: 4000 },
  { startMs: 4000, endMs: 6000 },
]

function makePlayer(sentences: SentenceRange[] = S) {
  const controller = new FakeController()
  const player = new SentencePlayer(controller, sentences)
  return { controller, player }
}

describe('locateSentence 二分定位', () => {
  it('首句之前返回 -1，越过后按 startMs 归属，末句 endMs 之后仍归末句', () => {
    const { player } = makePlayer()
    expect(player.locateSentence(-1)).toBe(-1)
    expect(player.locateSentence(0)).toBe(0)
    expect(player.locateSentence(1999)).toBe(0)
    expect(player.locateSentence(2000)).toBe(1)
    expect(player.locateSentence(5999)).toBe(2)
    expect(player.locateSentence(50_000)).toBe(2)
  })

  it('空句子表恒返回 -1', () => {
    const { player } = makePlayer([])
    expect(player.locateSentence(100)).toBe(-1)
  })
})

describe('sentencechange 派发', () => {
  it('仅句 index 变化时派发；playSentence 立即派发不等 timeupdate', () => {
    const { controller, player } = makePlayer()
    const spy = vi.fn()
    player.on('sentencechange', spy)

    controller.tick(100) // → 句 0
    controller.tick(600) // 仍在句 0：不派发
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenLastCalledWith(0)

    controller.tick(2500) // → 句 1
    expect(spy).toHaveBeenCalledTimes(2)

    player.playSentence(2)
    expect(spy).toHaveBeenLastCalledWith(2)
  })

  it('next 从未播放态（-1）落到第 0 句而不是跳过第一句', () => {
    const { controller, player } = makePlayer()
    player.next()
    expect(controller.seekCalls).toEqual([0])
    expect(player.getCurrentSentenceIndex()).toBe(0)
  })

  it('prev 在第 0 句不再前移', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.prev()
    expect(controller.seekCalls).toEqual([0])
    expect(player.getCurrentSentenceIndex()).toBe(0)
  })
})

describe('A-B 单句循环', () => {
  it('times=1：越界回跳一次，再次越界清除循环继续自然播放', () => {
    const { controller, player } = makePlayer()
    controller.tick(100) // 句 0
    player.setLoopTimes(1)
    expect(player.getLoopIndex()).toBe(0)

    controller.tick(2000 - LOOP_TOLERANCE_MS) // 1880：容差边界触发回跳
    expect(controller.seekCalls).toEqual([0])
    expect(player.getLoopIndex()).toBe(0) // 次数未耗尽（1→0 后仍允许本轮回跳后的播放）

    controller.tick(2000 - LOOP_TOLERANCE_MS) // 第二次越界：次数已用尽 → 清循环
    expect(controller.seekCalls).toEqual([0]) // 没有第二次回跳
    expect(player.getLoopIndex()).toBe(-1)
    expect(controller.clearLoopCalls).toBe(1)
  })

  it('times=1 实际把句子播两遍（首播 + 1 次重复）', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.setLoopTimes(1)
    controller.tick(1900) // 回跳 #1
    controller.tick(1900) // 次数耗尽，放行
    expect(controller.seekCalls.filter((ms) => ms === 0)).toHaveLength(1)
  })

  it('times=Infinity 连续越界连续回跳', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.setLoopTimes(Number.POSITIVE_INFINITY)
    controller.tick(1900)
    controller.tick(1900)
    controller.tick(1900)
    expect(controller.seekCalls.filter((ms) => ms === 0)).toHaveLength(3)
    expect(player.getLoopIndex()).toBe(0)
  })

  it('容差内不触发：endMs-121 不回跳，endMs-120 回跳', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.setLoopTimes(Number.POSITIVE_INFINITY)

    controller.tick(S[0]!.endMs - LOOP_TOLERANCE_MS - 1) // 1879
    expect(controller.seekCalls).toHaveLength(0)
    controller.tick(S[0]!.endMs - LOOP_TOLERANCE_MS) // 1880
    expect(controller.seekCalls).toEqual([0])
  })

  it('§5.1 漂移补偿：回跳落点晚 250ms 时边界右移，避免回跳瞬间二次越界连跳', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.setLoopTimes(Number.POSITIVE_INFINITY)

    controller.driftMs = 250
    // 边界 = endMs - 120 + drift = 2130；1880（原边界）与 2100 都不应触发
    controller.tick(1880)
    controller.tick(2100)
    expect(controller.seekCalls).toHaveLength(0)
    controller.tick(2130)
    expect(controller.seekCalls).toEqual([0])
  })

  it('open-ended 句（endMs<=startMs）不参与循环判断，避免立即回跳死循环', () => {
    const openEnded: SentenceRange[] = [{ startMs: 4000, endMs: 4000 }]
    const { controller, player } = makePlayer(openEnded)
    controller.tick(4000)
    player.setLoopTimes(Number.POSITIVE_INFINITY)
    controller.tick(9000)
    expect(controller.seekCalls).toHaveLength(0)
  })

  it('循环触发时本次 timeupdate 不再派发句定位（return 早退）', () => {
    const { controller, player } = makePlayer()
    const spy = vi.fn()
    player.on('sentencechange', spy)
    controller.tick(100)
    player.setLoopTimes(Number.POSITIVE_INFINITY)
    spy.mockClear()
    controller.tick(1900) // 回跳后 index 仍是 0，但本次派发被跳过
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('playRange 区间播放', () => {
  it('越过 endMs 自动暂停一次；rangeEnd 清除后不再误暂停', () => {
    const { controller, player } = makePlayer()
    player.playRange(1000, 2000)
    expect(controller.playCalls).toBe(1)
    expect(controller.seekCalls).toEqual([1000])

    controller.tick(2100)
    expect(controller.pauseCalls).toBe(1)
    controller.tick(2500) // 停点已消费：不再暂停
    expect(controller.pauseCalls).toBe(1)
  })

  it('open-ended 区间（endMs<=startMs）不设停点，播到媒体末尾', () => {
    const { controller, player } = makePlayer()
    player.playRange(4000, 4000)
    controller.tick(50_000)
    expect(controller.pauseCalls).toBe(0)
  })
})

describe('setSentences 换材料复用实例', () => {
  it('重置句索引与循环状态', () => {
    const { controller, player } = makePlayer()
    controller.tick(100)
    player.setLoopTimes(Number.POSITIVE_INFINITY)
    expect(player.getLoopIndex()).toBe(0)

    const next: SentenceRange[] = [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 3000 }]
    player.setSentences(next)
    expect(player.getLoopIndex()).toBe(-1)
    expect(player.getCurrentSentenceIndex()).toBe(-1)

    // 新列表事件正常工作：next() 落到新列表第 0 句
    player.next()
    expect(player.getCurrentSentenceIndex()).toBe(0)
  })
})

describe('ended / destroy', () => {
  it('播放到末尾派发 ended 并保持末句高亮', () => {
    const { controller, player } = makePlayer()
    const ended = vi.fn()
    const change = vi.fn()
    player.on('ended', ended)
    player.on('sentencechange', change)
    controller.end()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenLastCalledWith(2)
  })

  it('destroy 后事件不再派发且重复 destroy 幂等', () => {
    const { controller, player } = makePlayer()
    const change = vi.fn()
    player.on('sentencechange', change)
    player.destroy()
    player.destroy()
    controller.tick(100)
    expect(change).not.toHaveBeenCalled()
  })
})
