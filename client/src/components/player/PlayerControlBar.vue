<template>
  <view class="control-bar">
    <!-- 第一行：进度条 + 时间 -->
    <view class="progress-row">
      <text class="time">{{ formatMs(currentMs) }}</text>
      <slider
        class="progress-slider"
        :value="progress"
        :max="1000"
        activeColor="#3b6ef0"
        backgroundColor="#e5e6eb"
        :block-size="14"
        @change="onSeek"
        @changing="onSeek"
      />
      <text class="time">{{ formatMs(durationMs) }}</text>
    </view>
    <!-- 第二行：控制按钮（移动端拇指热区） -->
    <view class="button-row">
      <button class="ctrl-btn" :disabled="!hasPrev" @click="$emit('prev')">⏮</button>
      <button class="ctrl-btn ctrl-btn-main" @click="$emit('toggle-play')">
        {{ playing ? '⏸' : '▶' }}
      </button>
      <button class="ctrl-btn" :disabled="!hasNext" @click="$emit('next')">⏭</button>
      <button class="ctrl-btn" :class="{ active: loopMode !== 'off' }" @click="$emit('cycle-loop')">
        🔁<text class="loop-label">{{ loopLabel }}</text>
      </button>
      <button class="ctrl-btn" @click="showRateSheet = true">{{ rate.toFixed(2).replace(/0+$/, '').replace(/\.$/, '.0') }}x</button>
      <button class="ctrl-btn" @click="$emit('cycle-subtitle')">{{ subtitleLabel }}</button>
    </view>
    <!-- 倍速选择底部弹层 -->
    <view v-if="showRateSheet" class="sheet-mask" @click="showRateSheet = false">
      <view class="sheet" @click.stop>
        <view
          v-for="r in rates"
          :key="r"
          class="sheet-item"
          :class="{ selected: r === rate }"
          @click="onSelectRate(r)"
        >
          {{ r }}x
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { formatMs } from '@/utils/format';
import { PLAYBACK_RATES, type LoopMode, type SubtitleMode } from '@/stores/player';

const props = defineProps<{
  playing: boolean;
  currentMs: number;
  durationMs: number;
  rate: number;
  loopMode: LoopMode;
  subtitleMode: SubtitleMode;
  hasPrev: boolean;
  hasNext: boolean;
  /** 无字幕材料时隐藏逐句控制（原型设计 §4.3 边界） */
  sentenceEnabled: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle-play'): void;
  (e: 'prev'): void;
  (e: 'next'): void;
  (e: 'cycle-loop'): void;
  (e: 'cycle-subtitle'): void;
  (e: 'seek', ms: number): void;
  (e: 'update:rate', rate: number): void;
}>();

const rates = PLAYBACK_RATES;
const showRateSheet = ref(false);

const progress = computed(() =>
  props.durationMs > 0 ? Math.round((props.currentMs / props.durationMs) * 1000) : 0
);

const loopLabel = computed(() => {
  switch (props.loopMode) {
    case 'once':
      return '1次';
    case 'triple':
      return '3次';
    case 'infinite':
      return '∞';
    default:
      return '关';
  }
});

const subtitleLabel = computed(() => {
  switch (props.subtitleMode) {
    case 'both':
      return '双语';
    case 'en':
      return '仅英';
    case 'zh':
      return '仅中';
    default:
      return '字幕关';
  }
});

function onSeek(e: { detail: { value: number } }): void {
  if (props.durationMs > 0) {
    emit('seek', Math.round((e.detail.value / 1000) * props.durationMs));
  }
}

function onSelectRate(r: number): void {
  emit('update:rate', r);
  showRateSheet.value = false;
}
</script>

<style lang="scss" scoped>
.control-bar {
  background: #fff;
  padding: 12rpx 24rpx;
}
.progress-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.progress-slider {
  flex: 1;
}
.time {
  font-size: 22rpx;
  color: #646a73;
  min-width: 80rpx;
  text-align: center;
}
.button-row {
  display: flex;
  justify-content: space-around;
  align-items: center;
  margin-top: 8rpx;
}
.ctrl-btn {
  background: none;
  border: none;
  font-size: 36rpx;
  padding: 16rpx;
  line-height: 1;
  color: #1f2329;
  &::after {
    border: none;
  }
  &[disabled] {
    color: #c0c4cc;
  }
  &.active {
    color: #3b6ef0;
  }
}
.ctrl-btn-main {
  font-size: 56rpx;
}
.loop-label {
  font-size: 18rpx;
  margin-left: 4rpx;
}
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
}
.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  border-radius: 20rpx 20rpx 0 0;
  padding: 24rpx;
}
.sheet-item {
  padding: 24rpx;
  text-align: center;
  font-size: 30rpx;
  border-bottom: 1rpx solid #f0f0f0;
  &.selected {
    color: #3b6ef0;
    font-weight: 600;
  }
}
</style>
