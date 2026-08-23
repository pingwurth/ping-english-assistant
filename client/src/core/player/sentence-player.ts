/**
 * 句子级播放控制（架构文档 §2.2 sentence-player）
 * 组合 PlayerController + SubtitleData，供业务层直接使用。
 * 平台无关，可在 node 环境直接单测。
 */
import type { PlayerController } from './types';
import type { SubtitleData } from '../subtitle/model';

export type LoopTimes = 1 | 3 | typeof Infinity;

export interface SentencePlayerOptions {
  /** 循环到达边界的容差（ms），覆盖回调间隔导致的越界（架构文档 §5.1） */
  loopToleranceMs?: number;
}

export class SentencePlayer {
  private sentences: SubtitleData['sentences'];
  private currentIndex = -1;
  private loopSentenceIndex = -1;
  private loopRemaining: LoopTimes = Infinity;
  private loopEnabled = false;
  private tolerance: number;
  private sentenceChangeCbs = new Set<(index: number) => void>();
  private detachTimeupdate: (() => void) | null = null;

  constructor(
    private player: PlayerController,
    subtitle: SubtitleData,
    options: SentencePlayerOptions = {}
  ) {
    this.sentences = subtitle.sentences;
    this.tolerance = options.loopToleranceMs ?? 250;
    const onTime = (currentMs: number) => this.handleTimeupdate(currentMs);
    this.player.on('timeupdate', onTime);
    this.detachTimeupdate = () => this.player.off('timeupdate', onTime);
  }

  get size(): number {
    return this.sentences.length;
  }

  get index(): number {
    return this.currentIndex;
  }

  /** 播放第 i 句：seek 到 startMs 并播放 */
  async playSentence(i: number): Promise<void> {
    if (this.sentences.length === 0) return;
    const target = this.clamp(i);
    const s = this.sentences[target];
    this.currentIndex = target;
    // 任意 seek / 上下句操作重定向循环区间到目标句（原型设计 §6.2）
    if (this.loopEnabled) this.applyLoop(target);
    this.player.seekTo(s.startMs);
    await this.player.play();
    this.emitSentenceChange(target);
  }

  next(): Promise<void> {
    return this.playSentence(this.currentIndex + 1);
  }

  prev(): Promise<void> {
    return this.playSentence(this.currentIndex - 1);
  }

  /** 单句循环：对第 i 句设置 A-B loop，times 次后自动解除 */
  loopSentence(i: number, times: LoopTimes = Infinity): void {
    if (this.sentences.length === 0) return;
    this.loopEnabled = true;
    this.loopRemaining = times;
    this.applyLoop(this.clamp(i));
  }

  clearLoop(): void {
    this.loopEnabled = false;
    this.loopSentenceIndex = -1;
    this.loopRemaining = Infinity;
    this.player.clearLoop();
  }

  get looping(): boolean {
    return this.loopEnabled;
  }

  get loopRemainingTimes(): LoopTimes {
    return this.loopRemaining;
  }

  /** 二分查找当前句 index（sentences 按 startMs 升序） */
  locateSentence(currentMs: number): number {
    const arr = this.sentences;
    if (arr.length === 0) return -1;
    let lo = 0;
    let hi = arr.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].startMs <= currentMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  /** index 变化时才派发，避免高频 setData（架构文档 §2.6 性能要点） */
  onSentenceChange(cb: (index: number) => void): () => void {
    this.sentenceChangeCbs.add(cb);
    return () => this.sentenceChangeCbs.delete(cb);
  }

  destroy(): void {
    this.detachTimeupdate?.();
    this.sentenceChangeCbs.clear();
  }

  private clamp(i: number): number {
    return Math.max(0, Math.min(i, this.sentences.length - 1));
  }

  private applyLoop(i: number): void {
    const s = this.sentences[i];
    this.loopSentenceIndex = i;
    this.player.setLoop(s.startMs, s.endMs);
  }

  private handleTimeupdate(currentMs: number): void {
    // 单句循环：到达 endMs（含容差）→ seek 回 startMs，计数递减
    if (this.loopEnabled && this.loopSentenceIndex >= 0) {
      const s = this.sentences[this.loopSentenceIndex];
      if (currentMs >= s.endMs - this.tolerance) {
        if (this.loopRemaining !== Infinity) {
          this.loopRemaining = (this.loopRemaining - 1) as LoopTimes;
        }
        if (this.loopRemaining <= 0) {
          this.clearLoop();
          this.player.pause();
        } else {
          this.player.seekTo(s.startMs);
        }
        return;
      }
    }
    const idx = this.locateSentence(currentMs);
    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      this.emitSentenceChange(idx);
    }
  }

  private emitSentenceChange(index: number): void {
    this.sentenceChangeCbs.forEach((cb) => cb(index));
  }
}
