<template>
  <view class="record-button-wrap">
    <view
      class="record-button"
      :class="{ recording, processing }"
      @touchstart="onPressStart"
      @touchend="onPressEnd"
      @touchcancel="onPressEnd"
      @click="onTap"
    >
      <text class="mic">🎤</text>
      <text class="label">{{ label }}</text>
    </view>
    <view v-if="recording" class="recording-info">
      <text class="duration" :class="{ warning: nearLimit }">{{ durationText }}</text>
      <!-- 声波振幅条（音量回调驱动） -->
      <view class="wave">
        <view class="wave-bar" :style="{ height: `${8 + volume * 40}rpx` }" />
        <view class="wave-bar" :style="{ height: `${12 + volume * 56}rpx` }" />
        <view class="wave-bar" :style="{ height: `${8 + volume * 40}rpx` }" />
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

const props = defineProps<{
  /** 录音交互：按住说话 / 点按开始结束（设置页可配） */
  mode: 'hold' | 'tap';
  processing?: boolean;
  /** 最长录音毫秒数 */
  maxDurationMs?: number;
}>();

const emit = defineEmits<{
  (e: 'start'): void;
  (e: 'stop'): void;
}>();

const recording = ref(false);
const volume = ref(0);
const elapsedMs = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

const maxMs = computed(() => props.maxDurationMs ?? 600000);
const nearLimit = computed(() => maxMs.value - elapsedMs.value <= 10000);

const label = computed(() => {
  if (props.processing) return '评分中…';
  if (recording.value) return '松开结束';
  return props.mode === 'hold' ? '按住说话' : '点击开始';
});

const durationText = computed(() => {
  const sec = elapsedMs.value / 1000;
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${(sec % 60).toFixed(1).padStart(4, '0')} ● 录音中`;
});

function onPressStart(): void {
  if (props.mode !== 'hold' || props.processing || recording.value) return;
  start();
}

function onPressEnd(): void {
  if (props.mode !== 'hold' || !recording.value) return;
  stop();
}

function onTap(): void {
  if (props.mode !== 'tap' || props.processing) return;
  if (recording.value) stop();
  else start();
}

function start(): void {
  recording.value = true;
  startedAt = Date.now();
  elapsedMs.value = 0;
  timer = setInterval(() => {
    elapsedMs.value = Date.now() - startedAt;
  }, 100);
  emit('start');
}

function stop(): void {
  recording.value = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  emit('stop');
}

/** 外部驱动音量（RecorderEvents.volume 回调） */
function setVolume(level: number): void {
  volume.value = level;
}

/** 外部强制停止（到达上限等） */
function forceStop(): void {
  if (recording.value) stop();
}

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

defineExpose({ setVolume, forceStop, recording });
</script>

<style lang="scss" scoped>
.record-button-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.record-button {
  width: 160rpx;
  height: 160rpx;
  border-radius: 50%;
  background: #f0f1f5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  &.recording {
    background: #d83931;
    animation: pulse 1.2s ease-in-out infinite;
  }
  &.processing {
    opacity: 0.6;
  }
}
.mic {
  font-size: 48rpx;
}
.label {
  font-size: 20rpx;
  color: #646a73;
  .recording & {
    color: #fff;
  }
}
.recording-info {
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.duration {
  font-size: 26rpx;
  color: #1f2329;
  &.warning {
    color: #e8890c;
  }
}
.wave {
  display: flex;
  align-items: center;
  gap: 6rpx;
}
.wave-bar {
  width: 6rpx;
  background: #d83931;
  border-radius: 3rpx;
  transition: height 0.1s;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(216, 57, 49, 0.35);
  }
  50% {
    box-shadow: 0 0 0 20rpx rgba(216, 57, 49, 0);
  }
}
</style>
