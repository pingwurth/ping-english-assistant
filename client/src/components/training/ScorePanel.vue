<template>
  <view class="score-panel">
    <!-- 综合分环形 -->
    <view class="total-score">
      <view class="ring">
        <text class="score-num">{{ report.total }}</text>
        <text class="score-label">综合分</text>
      </view>
    </view>
    <!-- 三维条形图 -->
    <view class="dims">
      <view v-for="d in dims" :key="d.label" class="dim-row">
        <text class="dim-label">{{ d.label }}</text>
        <view class="dim-bar">
          <view class="dim-fill" :style="{ width: `${d.value}%` }" />
        </view>
        <text class="dim-value">{{ d.value }}</text>
      </view>
    </view>
    <!-- 单词级标色文本 -->
    <view v-if="markedWords.length" class="words">
      <text
        v-for="(w, i) in markedWords"
        :key="i"
        class="word"
        :class="{ low: w.low }"
        @click="onWordClick(w)"
      >
        {{ w.text }}
      </text>
    </view>
    <!-- 音素建议弹层 -->
    <view v-if="activeWord" class="phoneme-tip" @click="activeWord = null">
      <view class="phoneme-card" @click.stop>
        <text class="phoneme-word">{{ activeWord.text }}</text>
        <view v-for="(p, i) in activeWord.phonemes" :key="i" class="phoneme-row">
          <text class="symbol">/{{ p.symbol }}/</text>
          <text class="p-score" :class="{ low: p.score < 60 }">{{ p.score }}</text>
        </view>
        <button class="close-btn" @click="activeWord = null">关闭</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { markLowScoreWords, type ScoreReport, type WordScore } from '@/core/training/scoring';

const props = defineProps<{
  report: ScoreReport;
  /** 背诵模式维度集不同（原型设计 §4.10） */
  mode?: 'read-aloud' | 'recitation';
}>();

const activeWord = ref<(WordScore & { low: boolean }) | null>(null);

const dims = computed(() => {
  if (props.mode === 'recitation') {
    return [
      { label: '完整度', value: props.report.integrity },
      { label: '准确度', value: props.report.accuracy },
      { label: '流利度', value: props.report.fluency }
    ];
  }
  return [
    { label: '准确度', value: props.report.accuracy },
    { label: '流利度', value: props.report.fluency },
    { label: '完整度', value: props.report.integrity }
  ];
});

const markedWords = computed(() => markLowScoreWords(props.report));

function onWordClick(w: WordScore & { low: boolean }): void {
  if (w.low) activeWord.value = w;
}
</script>

<style lang="scss" scoped>
.score-panel {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
}
.total-score {
  display: flex;
  justify-content: center;
  margin-bottom: 24rpx;
}
.ring {
  width: 180rpx;
  height: 180rpx;
  border-radius: 50%;
  border: 12rpx solid #3b6ef0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.score-num {
  font-size: 56rpx;
  font-weight: 700;
  color: #3b6ef0;
}
.score-label {
  font-size: 22rpx;
  color: #646a73;
}
.dim-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 16rpx;
}
.dim-label {
  width: 100rpx;
  font-size: 24rpx;
  color: #646a73;
}
.dim-bar {
  flex: 1;
  height: 16rpx;
  background: #f0f1f5;
  border-radius: 8rpx;
  overflow: hidden;
}
.dim-fill {
  height: 100%;
  background: #3b6ef0;
  border-radius: 8rpx;
}
.dim-value {
  width: 60rpx;
  text-align: right;
  font-size: 24rpx;
}
.words {
  margin-top: 16rpx;
  line-height: 2;
}
.word {
  font-size: 30rpx;
  margin-right: 12rpx;
  &.low {
    color: #d83931;
    text-decoration: underline;
  }
}
.phoneme-tip {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}
.phoneme-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  min-width: 480rpx;
}
.phoneme-word {
  font-size: 36rpx;
  font-weight: 600;
}
.phoneme-row {
  display: flex;
  justify-content: space-between;
  padding: 12rpx 0;
}
.p-score.low {
  color: #d83931;
}
.close-btn {
  margin-top: 16rpx;
  background: #f0f1f5;
  font-size: 26rpx;
}
</style>
