<template>
  <view class="player-page">
    <view class="main" :class="{ 'main-pc': isPc }">
      <!-- 左栏：媒体区 + 控制条 -->
      <view class="left">
        <!-- 媒体区 -->
        <view class="media-area">
          <!-- #ifdef MP-WEIXIN -->
          <video
            v-if="material?.mediaType === 'video'"
            id="mp-player"
            class="media-video"
            :src="mediaSrc"
            @timeupdate="onMpTimeupdate"
            @play="onMpPlay"
            @pause="onMpPause"
            @ended="onMpEnded"
            @error="onMpError"
          />
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <view v-if="material?.mediaType === 'video'" ref="videoContainerRef" class="media-video" />
          <!-- #endif -->
          <!-- 音频材料：封面 + 材料信息卡 -->
          <view v-if="material?.mediaType === 'audio'" class="audio-cover">
            <text class="audio-icon">🎵</text>
            <text class="audio-name">{{ material.name }}</text>
            <text class="audio-meta">
              {{ material.subtitle?.sentenceCount ?? 0 }} 句 · {{ formatMs(material.durationMs) }}
            </text>
          </view>
          <!-- 内嵌字幕层 -->
          <SubtitleOverlay :sentence="currentSentence" :mode="playerStore.subtitleMode" />
        </view>

        <!-- 播放控制条 -->
        <PlayerControlBar
          :playing="playerStore.state === 'playing'"
          :current-ms="playerStore.currentTimeMs"
          :duration-ms="playerStore.durationMs || material?.durationMs || 0"
          :rate="playerStore.rate"
          :loop-mode="playerStore.loopMode"
          :subtitle-mode="playerStore.subtitleMode"
          :has-prev="playerStore.currentSentenceIndex > 0"
          :has-next="hasNext"
          :sentence-enabled="sentenceCount > 0"
          @toggle-play="togglePlay"
          @prev="prev"
          @next="next"
          @cycle-loop="cycleLoop"
          @cycle-subtitle="cycleSubtitle"
          @seek="seek"
          @update:rate="setRate"
        />

        <!-- 当前句卡片（PC 端专属，原型设计 §4.3） -->
        <!-- #ifdef H5 -->
        <view v-if="isPc && currentSentence" class="current-card">
          <view class="current-text">
            <text class="en">{{ currentSentence.textEn }}</text>
            <text v-if="currentSentence.textZh" class="zh">{{ currentSentence.textZh }}</text>
          </view>
          <view class="current-actions">
            <button class="mini-btn" @click="toggleFavorite">⭐ {{ favorited ? '已收藏' : '收藏' }}</button>
            <button class="mini-btn primary" @click="trainCurrent">⚡ 就练这句</button>
          </view>
        </view>
        <!-- #endif -->
      </view>

      <!-- 右栏：字幕列表 -->
      <view class="right">
        <SubtitleList
          :sentences="sentences"
          :current-index="playerStore.currentSentenceIndex"
          :mode="playerStore.subtitleMode"
          @select="selectSentence"
          @longpress="onSentenceLongPress"
        />
      </view>
    </view>

    <!-- 进入训练入口 -->
    <view class="train-entry">
      <button class="btn-train" @click="goTraining">⚡ 进入训练</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { onLoad, onReady, onUnload } from '@dcloudio/uni-app';
import PlayerControlBar from '@/components/player/PlayerControlBar.vue';
import SubtitleList from '@/components/player/SubtitleList.vue';
import SubtitleOverlay from '@/components/player/SubtitleOverlay.vue';
import { useMaterialStore } from '@/stores/material';
import { usePlayerStore, type LoopMode } from '@/stores/player';
import { useSettingsStore } from '@/stores/settings';
import { createPlayer } from '@/platform/player';
import { getStorage } from '@/platform/storage';
import { SentencePlayer, type LoopTimes } from '@/core/player/sentence-player';
import type { PlayerController } from '@/core/player/types';
import { formatMs } from '@/utils/format';

const materialStore = useMaterialStore();
const playerStore = usePlayerStore();
const settingsStore = useSettingsStore();

const material = computed(() => materialStore.currentMaterial);
const sentences = computed(() => materialStore.subtitleData?.sentences ?? []);
const sentenceCount = computed(() => sentences.value.length);
const hasNext = computed(
  () => playerStore.currentSentenceIndex >= -1 && playerStore.currentSentenceIndex < sentenceCount.value - 1
);
const currentSentence = computed(() =>
  playerStore.currentSentenceIndex >= 0 ? sentences.value[playerStore.currentSentenceIndex] ?? null : null
);
const favorited = computed(() =>
  material.value && playerStore.currentSentenceIndex >= 0
    ? materialStore.isFavorited(material.value.id, playerStore.currentSentenceIndex)
    : false
);

const mediaSrc = ref('');
const videoContainerRef = ref<HTMLElement | null>(null);
const isPc = ref(false);

let controller: PlayerController | null = null;
let materialId = '';

onLoad((query) => {
  materialId = query?.materialId ?? '';
  // #ifdef H5
  isPc.value = typeof window !== 'undefined' && window.innerWidth >= 1024;
  // #endif
});

onReady(async () => {
  await init();
});

onUnload(() => {
  playerStore.detach();
  controller?.destroy();
  controller = null;
});

onUnmounted(() => {
  controller?.destroy();
  controller = null;
});

async function init(): Promise<void> {
  try {
    if (materialId) await materialStore.openMaterial(materialId);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '材料加载失败', icon: 'none' });
    return;
  }
  if (!material.value) {
    // 无 materialId 直达且无 currentMaterial → 跳回材料库（架构文档 §2.7）
    uni.switchTab({ url: '/pages/index/index' });
    return;
  }
  mediaSrc.value = await getStorage().resolveFileSrc(material.value.mediaRef);

  controller = createPlayer(material.value.mediaType);
  controller.on('timeupdate', (ms) => {
    playerStore.currentTimeMs = ms;
  });
  controller.on('statechange', (s) => playerStore.setState(s));

  // #ifdef H5
  if (material.value.mediaType === 'video' && videoContainerRef.value) {
    (controller as { mount?: (el: HTMLElement) => void }).mount?.(videoContainerRef.value);
  }
  // #endif

  await controller.load({ type: material.value.mediaType, src: mediaSrc.value });
  controller.setRate(playerStore.rate || settingsStore.settings.defaultRate);
  playerStore.durationMs = controller.getDurationMs() || material.value.durationMs;

  // 有字幕：挂接句子级控制
  if (materialStore.subtitleData && sentenceCount.value > 0) {
    const sp = new SentencePlayer(controller, materialStore.subtitleData);
    playerStore.attachSentencePlayer(sp);
    sp.onSentenceChange((idx) => {
      if (material.value) void materialStore.markSentencePlayed(material.value.id, idx);
    });
  }

  // #ifdef H5
  bindKeyboard();
  // #endif
}

// ---- 播放控制 ----

async function togglePlay(): Promise<void> {
  if (!controller) return;
  if (playerStore.state === 'playing') controller.pause();
  else await controller.play();
}

function prev(): void {
  void playerStore.sentencePlayer?.prev();
}

function next(): void {
  void playerStore.sentencePlayer?.next();
}

function seek(ms: number): void {
  controller?.seekTo(ms);
}

function setRate(rate: number): void {
  playerStore.rate = rate;
  controller?.setRate(rate);
}

const loopTimesMap: Record<LoopMode, LoopTimes | 0> = {
  off: 0,
  once: 1,
  triple: 3,
  infinite: Infinity
};

function cycleLoop(): void {
  const mode = playerStore.cycleLoopMode();
  const sp = playerStore.sentencePlayer;
  if (!sp) return;
  const times = loopTimesMap[mode];
  if (times === 0) sp.clearLoop();
  else sp.loopSentence(Math.max(0, playerStore.currentSentenceIndex), times);
}

function cycleSubtitle(): void {
  playerStore.cycleSubtitleMode(materialStore.subtitleData?.isBilingual ?? false);
}

function selectSentence(index: number): void {
  void playerStore.sentencePlayer?.playSentence(index);
}

function onSentenceLongPress(index: number): void {
  if (!material.value) return;
  uni.showActionSheet({
    itemList: ['⭐ 收藏', '📋 复制文本'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        void materialStore.toggleFavorite(material.value!.id, index);
      } else if (tapIndex === 1) {
        const s = sentences.value[index];
        uni.setClipboardData({ data: s.textZh ? `${s.textEn}\n${s.textZh}` : s.textEn });
      }
    }
  });
}

function toggleFavorite(): void {
  if (material.value && playerStore.currentSentenceIndex >= 0) {
    void materialStore.toggleFavorite(material.value.id, playerStore.currentSentenceIndex);
  }
}

function trainCurrent(): void {
  goTraining();
}

function goTraining(): void {
  uni.navigateTo({ url: `/pages/training/index?materialId=${material.value?.id ?? materialId}` });
}

// ---- 小程序 <video> 事件转发（MpVideoAdapter） ----
// uni-app 小程序事件对象含 detail 字段；模板类型按 DOM Event 推断，此处统一断言
interface MpVideoEvent {
  detail: { currentTime: number; duration: number };
}

function onMpTimeupdate(e: unknown): void {
  const { detail } = e as MpVideoEvent;
  (controller as unknown as { handleTimeupdate?: (c: number, d: number) => void })?.handleTimeupdate?.(
    detail.currentTime,
    detail.duration
  );
}
function onMpPlay(): void {
  (controller as unknown as { handlePlay?: () => void })?.handlePlay?.();
}
function onMpPause(): void {
  (controller as unknown as { handlePause?: () => void })?.handlePause?.();
}
function onMpEnded(): void {
  (controller as unknown as { handleEnded?: () => void })?.handleEnded?.();
}
function onMpError(e: unknown): void {
  (controller as unknown as { handleError?: (err: unknown) => void })?.handleError?.(e);
}

// ---- PC 快捷键（原型设计 §6.4） ----
// #ifdef H5
function bindKeyboard(): void {
  window.addEventListener('keydown', onKeydown);
}

function onKeydown(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      void togglePlay();
      break;
    case 'ArrowLeft':
      prev();
      break;
    case 'ArrowRight':
      next();
      break;
    case 'r':
    case 'R':
      cycleLoop();
      break;
    case 'c':
    case 'C':
      cycleSubtitle();
      break;
    case '1':
      shiftRate(-1);
      break;
    case '2':
      shiftRate(1);
      break;
  }
}

function shiftRate(dir: -1 | 1): void {
  const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  const idx = rates.indexOf(playerStore.rate);
  const next = rates[Math.min(rates.length - 1, Math.max(0, idx + dir))];
  setRate(next);
}

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
// #endif
</script>

<style lang="scss" scoped>
.player-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  &.main-pc {
    flex-direction: row;
    .left {
      flex: 0 0 62%;
    }
    .right {
      flex: 0 0 38%;
      border-left: 1rpx solid #e5e6eb;
    }
  }
}
.left {
  display: flex;
  flex-direction: column;
}
.media-area {
  position: relative;
  background: #000;
  aspect-ratio: 16 / 9;
}
.media-video {
  width: 100%;
  height: 100%;
}
.audio-cover {
  width: 100%;
  height: 100%;
  min-height: 320rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  background: linear-gradient(135deg, #1f2329, #3b4260);
}
.audio-icon {
  font-size: 96rpx;
}
.audio-name {
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}
.audio-meta {
  color: rgba(255, 255, 255, 0.7);
  font-size: 22rpx;
}
.right {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.current-card {
  margin: 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.current-text .en {
  font-size: 36rpx;
  font-weight: 600;
  display: block;
}
.current-text .zh {
  font-size: 28rpx;
  color: #646a73;
}
.current-actions {
  display: flex;
  gap: 16rpx;
}
.mini-btn {
  font-size: 24rpx;
  background: #f0f1f5;
  border-radius: 12rpx;
  padding: 0 24rpx;
  line-height: 56rpx;
  &::after {
    border: none;
  }
  &.primary {
    background: #3b6ef0;
    color: #fff;
  }
}
.train-entry {
  padding: 16rpx 24rpx calc(16rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1rpx solid #e5e6eb;
}
.btn-train {
  background: #3b6ef0;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
}
</style>
