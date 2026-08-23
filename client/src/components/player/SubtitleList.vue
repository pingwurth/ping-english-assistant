<template>
  <scroll-view
    class="subtitle-list"
    scroll-y
    :scroll-into-view="scrollTargetId"
    :scroll-with-animation="true"
    @touchstart="onUserScroll"
  >
    <view
      v-for="s in sentences"
      :id="`sentence-${s.index}`"
      :key="s.index"
      class="sentence-item"
      :class="{ active: s.index === currentIndex }"
      @click="$emit('select', s.index)"
      @longpress="onLongPress(s.index)"
    >
      <view class="meta">
        <text class="index">{{ s.index + 1 }}</text>
        <text class="time">{{ formatMs(s.startMs) }}</text>
        <text v-if="s.index === currentIndex" class="playing-mark">▶</text>
      </view>
      <view class="text">
        <text v-if="mode === 'both' || mode === 'en'" class="en">{{ s.textEn }}</text>
        <text v-if="(mode === 'both' || mode === 'zh') && s.textZh" class="zh">{{ s.textZh }}</text>
      </view>
    </view>
    <view v-if="sentences.length === 0" class="empty">
      <text>暂无字幕内容</text>
    </view>
  </scroll-view>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SubtitleSentence } from '@/core/subtitle';
import { formatMs } from '@/utils/format';
import type { SubtitleMode } from '@/stores/player';

const props = defineProps<{
  sentences: SubtitleSentence[];
  currentIndex: number;
  mode: SubtitleMode;
}>();

const emit = defineEmits<{
  (e: 'select', index: number): void;
  (e: 'longpress', index: number): void;
}>();

const scrollTargetId = ref('');
/** 用户手动滚动后暂停自动跟随 5s（原型设计 §5.2） */
const followSuspendedUntil = ref(0);

watch(
  () => props.currentIndex,
  (idx) => {
    if (idx < 0) return;
    if (Date.now() < followSuspendedUntil.value) return;
    // 变化时平滑滚动至可视区（scroll-into-view 定位目标句）
    scrollTargetId.value = '';
    setTimeout(() => {
      scrollTargetId.value = `sentence-${idx}`;
    }, 20);
  }
);

function onUserScroll(): void {
  followSuspendedUntil.value = Date.now() + 5000;
}

function onLongPress(index: number): void {
  emit('longpress', index);
}

const sentences = computed(() => props.sentences);
</script>

<style lang="scss" scoped>
.subtitle-list {
  height: 100%;
  background: #fff;
}
.sentence-item {
  display: flex;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
  &.active {
    background: #fff7e6;
  }
}
.meta {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  min-width: 120rpx;
}
.index {
  color: #8a9199;
  font-size: 22rpx;
}
.time {
  color: #8a9199;
  font-size: 20rpx;
}
.playing-mark {
  color: #3b6ef0;
  font-size: 20rpx;
}
.text {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.en {
  color: #1f2329;
  font-size: 28rpx;
}
.zh {
  color: #646a73;
  font-size: 24rpx;
}
.empty {
  padding: 80rpx;
  text-align: center;
  color: #8a9199;
}
</style>
