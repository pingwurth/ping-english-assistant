/**
 * SentencePlayer 单测（架构文档 §2.2）
 * mock PlayerController 验证：逐句跳转、二分定位、A-B 循环计数、index 变化去重派发。
 */
import { describe, expect, it, vi } from 'vitest';
import { SentencePlayer } from '../src/core/player/sentence-player';
import type { MediaSource, PlayerController } from '../src/core/player/types';
import type { SubtitleData } from '../src/core/subtitle';

class MockPlayer implements PlayerController {
  currentMs = 0;
  playing = false;
  loop: { startMs: number; endMs: number } | null = null;
  private cbs = new Map<string, Set<(ms: number) => void>>();

  async load(_s: MediaSource): Promise<void> {}
  async play(): Promise<void> {
    this.playing = true;
  }
  pause(): void {
    this.playing = false;
  }
  seekTo(ms: number): void {
    this.currentMs = ms;
  }
  setRate(): void {}
  setVolume(): void {}
  setLoop(startMs: number, endMs: number): void {
    this.loop = { startMs, endMs };
  }
  clearLoop(): void {
    this.loop = null;
  }
  getCurrentTimeMs(): number {
    return this.currentMs;
  }
  getDurationMs(): number {
    return 60000;
  }
  on(e: string, cb: unknown): void {
    if (!this.cbs.has(e)) this.cbs.set(e, new Set());
    this.cbs.get(e)!.add(cb as (ms: number) => void);
  }
  off(e: string, cb: unknown): void {
    this.cbs.get(e)?.delete(cb as (ms: number) => void);
  }
  destroy(): void {}

  tick(ms: number): void {
    this.currentMs = ms;
    this.cbs.get('timeupdate')?.forEach((cb) => cb(ms));
  }
}

const SUBTITLE: SubtitleData = {
  format: 'srt',
  isBilingual: false,
  totalDurationMs: 9000,
  sentences: [
    { index: 0, startMs: 0, endMs: 3000, textEn: 'One.', textZh: null, words: ['One'] },
    { index: 1, startMs: 3000, endMs: 6000, textEn: 'Two.', textZh: null, words: ['Two'] },
    { index: 2, startMs: 6000, endMs: 9000, textEn: 'Three.', textZh: null, words: ['Three'] }
  ]
};

describe('SentencePlayer', () => {
  it('playSentence：seek 到 startMs 并播放', async () => {
    const p = new MockPlayer();
    const sp = new SentencePlayer(p, SUBTITLE);
    await sp.playSentence(1);
    expect(p.currentMs).toBe(3000);
    expect(p.playing).toBe(true);
    expect(sp.index).toBe(1);
  });

  it('next/prev 边界 clamp', async () => {
    const p = new MockPlayer();
    const sp = new SentencePlayer(p, SUBTITLE);
    await sp.playSentence(0);
    await sp.prev();
    expect(sp.index).toBe(0);
    await sp.playSentence(2);
    await sp.next();
    expect(sp.index).toBe(2);
  });

  it('locateSentence 二分查找', () => {
    const sp = new SentencePlayer(new MockPlayer(), SUBTITLE);
    expect(sp.locateSentence(0)).toBe(0);
    expect(sp.locateSentence(2999)).toBe(0);
    expect(sp.locateSentence(3000)).toBe(1);
    expect(sp.locateSentence(8999)).toBe(2);
  });

  it('index 变化才派发 onSentenceChange（去重）', async () => {
    const p = new MockPlayer();
    const sp = new SentencePlayer(p, SUBTITLE);
    const cb = vi.fn();
    sp.onSentenceChange(cb);
    p.tick(100);
    p.tick(200);
    p.tick(3100);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(1);
  });

  it('单句循环：到达 endMs seek 回 startMs，3 次后自动解除并暂停', async () => {
    const p = new MockPlayer();
    const sp = new SentencePlayer(p, SUBTITLE, { loopToleranceMs: 250 });
    await sp.playSentence(1); // [3000, 6000]
    sp.loopSentence(1, 3);
    expect(p.loop).toEqual({ startMs: 3000, endMs: 6000 });

    p.tick(6000); // 第 1 次到边界 → 回 3000，剩余 2
    expect(p.currentMs).toBe(3000);
    expect(sp.loopRemainingTimes).toBe(2);

    p.tick(6000); // 第 2 次
    p.tick(6000); // 第 3 次 → 解除 + 暂停
    expect(sp.looping).toBe(false);
    expect(p.loop).toBeNull();
    expect(p.playing).toBe(false);
  });

  it('循环中 seek 其他句：循环区间重定向', async () => {
    const p = new MockPlayer();
    const sp = new SentencePlayer(p, SUBTITLE);
    sp.loopSentence(0, Infinity);
    await sp.playSentence(2);
    expect(p.loop).toEqual({ startMs: 6000, endMs: 9000 });
  });
});
