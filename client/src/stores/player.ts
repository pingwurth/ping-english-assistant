/**
 * 播放状态 Store（架构文档 §2.6）
 * 持有当前 SentencePlayer 实例（markRaw 非响应式）；字幕三态全局生效。
 */
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import type { PlayerState } from '@/core/player/types';
import type { SentencePlayer } from '@/core/player/sentence-player';
import type { SubtitleData } from '@/core/subtitle';

export type SubtitleMode = 'both' | 'en' | 'zh' | 'off';

export type LoopMode = 'off' | 'once' | 'triple' | 'infinite';

export const PLAYBACK_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0] as const;

export const usePlayerStore = defineStore('player', () => {
  const state = ref<PlayerState>('idle');
  const rate = ref(1.0);
  const volume = ref(1);
  const subtitleMode = ref<SubtitleMode>('both');
  const currentSentenceIndex = ref(-1);
  const loopMode = ref<LoopMode>('off');
  const currentTimeMs = ref(0);
  const durationMs = ref(0);

  /** 当前句播放器实例（非响应式，避免高频 setData） */
  const sentencePlayer = ref<SentencePlayer | null>(null);

  function attachSentencePlayer(sp: SentencePlayer): void {
    sentencePlayer.value?.destroy();
    sentencePlayer.value = markRaw(sp);
    sp.onSentenceChange((idx) => {
      currentSentenceIndex.value = idx;
    });
  }

  function detach(): void {
    sentencePlayer.value?.destroy();
    sentencePlayer.value = null;
    currentSentenceIndex.value = -1;
    state.value = 'idle';
  }

  /** 字幕三态循环：双语 → 仅英 → 仅中；非双语材料为 开/关 两态 */
  function cycleSubtitleMode(isBilingual: boolean): void {
    if (!isBilingual) {
      subtitleMode.value = subtitleMode.value === 'off' ? 'both' : 'off';
      return;
    }
    const order: SubtitleMode[] = ['both', 'en', 'zh'];
    const idx = order.indexOf(subtitleMode.value);
    subtitleMode.value = order[(idx + 1) % order.length];
  }

  /** 单句循环：关 → 1次 → 3次 → ∞ → 关 */
  function cycleLoopMode(): LoopMode {
    const order: LoopMode[] = ['off', 'once', 'triple', 'infinite'];
    const idx = order.indexOf(loopMode.value);
    loopMode.value = order[(idx + 1) % order.length];
    return loopMode.value;
  }

  function setState(s: PlayerState): void {
    state.value = s;
  }

  return {
    state,
    rate,
    volume,
    subtitleMode,
    currentSentenceIndex,
    loopMode,
    currentTimeMs,
    durationMs,
    sentencePlayer,
    attachSentencePlayer,
    detach,
    cycleSubtitleMode,
    cycleLoopMode,
    setState
  };
});
