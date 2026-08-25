/**
 * 句子级播放控制 —— 真源：docs/系统架构设计.md §2.2 SentencePlayer
 *
 * 组合 PlayerController + 句子时间轴，向业务层提供句子粒度 API：
 *  - locateSentence：按 startMs 二分查找定位当前句（驱动字幕高亮）；
 *  - onSentenceChange：内部订阅 timeupdate，仅当句 index 变化时派发（避免高频渲染）；
 *  - playSentence / next / prev：句级跳转；
 *  - A-B 单句循环：次数 关(0)→1→3→∞，循环边界判断带 ±120ms 容差
 *    （防止 timeupdate 回调间隔越过边界漏触发，见架构 §5.1）。
 *
 * 纯 TS、零框架依赖，可在 node 直接单测（注入 fake PlayerController）。
 */

import type { PlayerController, PlayerError, PlayerState } from './types'

/** SentencePlayer 仅需句子的时间轴字段（与 SubtitleSentence 结构兼容） */
export interface SentenceRange {
  startMs: number
  endMs: number
}

/** 循环边界容差：±120ms（架构 §5.1：`>=` 加容差，防止回调间隔越过边界漏触发） */
export const LOOP_TOLERANCE_MS = 120

export interface SentencePlayerEvents {
  /** 句 index 变化（-1 表示处于首句之前的空白区） */
  sentencechange: (index: number) => void
  /** 原始进度透传（驱动进度条） */
  timeupdate: (currentMs: number) => void
  statechange: (state: PlayerState) => void
  ended: () => void
  error: (err: PlayerError) => void
}

export class SentencePlayer {
  private controller: PlayerController
  private sentences: SentenceRange[]
  private handlers: { [E in keyof SentencePlayerEvents]: Set<SentencePlayerEvents[E]> } = {
    sentencechange: new Set(),
    timeupdate: new Set(),
    statechange: new Set(),
    ended: new Set(),
    error: new Set(),
  }

  private lastIndex = -1
  /** 循环目标句（-1 = 未开启） */
  private loopIndex = -1
  /** 剩余循环回跳次数；Infinity = 无限（times 语义：首次播完后再重复的次数） */
  private loopRemaining: number = 0
  /** 区间播放（如训练页单句试听）：到达 endMs 自动暂停 */
  private rangeEndMs: number | null = null
  private destroyed = false

  constructor(controller: PlayerController, sentences: SentenceRange[]) {
    this.controller = controller
    this.sentences = sentences
    controller.on('timeupdate', this.handleTimeUpdate)
    controller.on('statechange', this.handleStateChange)
    controller.on('ended', this.handleEnded)
    controller.on('error', this.handleError)
  }

  // ── 事件订阅 ──────────────────────────────────────────────
  on<E extends keyof SentencePlayerEvents>(event: E, cb: SentencePlayerEvents[E]): void {
    this.handlers[event].add(cb)
  }
  off<E extends keyof SentencePlayerEvents>(event: E, cb: SentencePlayerEvents[E]): void {
    this.handlers[event].delete(cb)
  }
  private emit<E extends keyof SentencePlayerEvents>(event: E, ...args: Parameters<SentencePlayerEvents[E]>): void {
    for (const cb of this.handlers[event]) (cb as (...a: unknown[]) => void)(...args)
  }

  // ── 基础控制（透传） ──────────────────────────────────────
  play(): Promise<void> { return this.controller.play() }
  pause(): void { this.controller.pause() }
  seekTo(ms: number): void { this.controller.seekTo(ms) }
  setRate(rate: number): void { this.controller.setRate(rate) }
  setVolume(volume: number): void { this.controller.setVolume(volume) }
  getCurrentTimeMs(): number { return this.controller.getCurrentTimeMs() }
  getDurationMs(): number { return this.controller.getDurationMs() }
  getState(): PlayerState { return this.controller.getState() }

  // ── 句子级控制 ────────────────────────────────────────────
  /** 播放第 i 句：seek 到句首并播放；立即派发 sentencechange（不等首个 timeupdate） */
  playSentence(i: number): void {
    const s = this.sentences[i]
    if (!s) return
    this.rangeEndMs = null
    this.controller.seekTo(s.startMs)
    void this.controller.play()
    this.dispatchSentence(i)
  }

  next(): void {
    this.playSentence(Math.min(this.sentences.length - 1, Math.max(0, this.lastIndex) + 1))
  }

  prev(): void {
    this.playSentence(Math.max(0, (this.lastIndex < 0 ? 0 : this.lastIndex) - 1))
  }

  /**
   * 播放 [startMs, endMs] 区间一遍后自动暂停（训练页单句试听；播几遍计几遍由调用方控制）。
   * open-ended 区间（endMs<=startMs，如未回填时长的 LRC 末句）→ 不设停点，回退播到媒体末尾。
   */
  playRange(startMs: number, endMs: number): void {
    this.rangeEndMs = endMs > startMs ? endMs : null
    this.controller.seekTo(startMs)
    void this.controller.play()
  }

  /**
   * 设置 A-B 单句循环。times：0=关闭；1/3=有限次；Infinity=∞。
   * 开启时对当前句设置循环区间；播放到句尾（含 ±120ms 容差）自动回跳句首。
   */
  setLoopTimes(times: number): void {
    if (times <= 0) {
      this.loopIndex = -1
      this.loopRemaining = 0
      this.controller.clearLoop()
      return
    }
    const i = Math.max(0, this.lastIndex)
    if (!this.sentences[i]) return
    this.loopIndex = i
    this.loopRemaining = times
  }

  getLoopIndex(): number { return this.loopIndex }

  getCurrentSentenceIndex(): number { return this.lastIndex }

  /**
   * 按 startMs 二分查找定位 currentMs 所属句子；
   * 首句 startMs 之前返回 -1；最后一句 endMs 之后仍归属末句。
   */
  locateSentence(currentMs: number): number {
    const list = this.sentences
    const n = list.length
    if (n === 0 || currentMs < list[0]!.startMs) return -1
    let lo = 0
    let hi = n - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid]!.startMs <= currentMs) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return ans
  }

  /** 切换句子列表（换材料时复用实例） */
  setSentences(sentences: SentenceRange[]): void {
    this.sentences = sentences
    this.loopIndex = -1
    this.loopRemaining = 0
    this.lastIndex = -1
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.controller.off('timeupdate', this.handleTimeUpdate)
    this.controller.off('statechange', this.handleStateChange)
    this.controller.off('ended', this.handleEnded)
    this.controller.off('error', this.handleError)
    for (const key of Object.keys(this.handlers) as (keyof SentencePlayerEvents)[]) this.handlers[key].clear()
  }

  // ── 内部事件 ──────────────────────────────────────────────
  private handleTimeUpdate = (currentMs: number): void => {
    this.emit('timeupdate', currentMs)

    // 区间播放（训练页试听）：越过 endMs 即暂停
    if (this.rangeEndMs !== null && currentMs >= this.rangeEndMs) {
      this.rangeEndMs = null
      this.controller.pause()
      return
    }

    // A-B 单句循环：边界 `>=` 减容差判断，回跳句首并递减次数；
    // open-ended 句（endMs<=startMs，未回填的 LRC 末句）跳过循环判断，避免立即回跳死循环
    if (this.loopIndex >= 0) {
      const s = this.sentences[this.loopIndex]
      if (s && s.endMs > s.startMs && currentMs >= s.endMs - LOOP_TOLERANCE_MS) {
        if (this.loopRemaining === Number.POSITIVE_INFINITY || this.loopRemaining > 0) {
          if (this.loopRemaining !== Number.POSITIVE_INFINITY) this.loopRemaining -= 1
          this.controller.seekTo(s.startMs)
          return
        }
        // 次数用尽 → 清除循环，自然播放越过句尾
        this.loopIndex = -1
        this.loopRemaining = 0
        this.controller.clearLoop()
      }
    }

    // 句 index 变化才派发（避免高频 setData/渲染）
    this.dispatchSentence(this.locateSentence(currentMs))
  }

  private handleStateChange = (state: PlayerState): void => { this.emit('statechange', state) }

  private handleEnded = (): void => {
    this.emit('ended')
    // 播放到文件末尾：定位末句并保持高亮
    if (this.sentences.length > 0) this.dispatchSentence(this.sentences.length - 1)
  }

  private handleError = (err: PlayerError): void => { this.emit('error', err) }

  private dispatchSentence(index: number): void {
    if (index === this.lastIndex) return
    this.lastIndex = index
    this.emit('sentencechange', index)
  }
}
