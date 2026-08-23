<template>
  <!-- 视频画面底部内嵌字幕层（原型设计 §4.3），三态与列表联动 -->
  <view v-if="visible" class="subtitle-overlay">
    <view class="overlay-text">
      <text v-if="mode === 'both' || mode === 'en'" class="en">{{ sentence?.textEn }}</text>
      <text v-if="(mode === 'both' || mode === 'zh') && sentence?.textZh" class="zh">{{ sentence?.textZh }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SubtitleSentence } from '@/core/subtitle';
import type { SubtitleMode } from '@/stores/player';

const props = defineProps<{
  sentence: SubtitleSentence | null;
  mode: SubtitleMode;
}>();

const visible = computed(() => props.mode !== 'off' && props.sentence != null);
</script>

<style lang="scss" scoped>
.subtitle-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 24rpx;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.overlay-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 12rpx;
  padding: 8rpx 24rpx;
  max-width: 90%;
}
.en {
  color: #fff;
  font-size: 30rpx;
  text-align: center;
}
.zh {
  color: rgba(255, 255, 255, 0.85);
  font-size: 24rpx;
  text-align: center;
}
</style>
