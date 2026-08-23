<template>
  <view class="page">
    <!-- 综合分环形 -->
    <view class="score-ring">
      <view class="ring">
        <text class="score">{{ result?.total ?? '-' }}</text>
        <text class="label">综合分</text>
      </view>
    </view>

    <!-- 维度条形图 -->
    <view class="dims">
      <view v-for="d in dims" :key="d.label" class="dim-row">
        <text class="dim-label">{{ d.label }}</text>
        <view class="dim-bar"><view class="dim-fill" :style="{ width: `${d.value}%` }" /></view>
        <text class="dim-value">{{ d.value ?? '-' }}</text>
      </view>
    </view>

    <!-- AI 详细分析（SSE 流式 Markdown） -->
    <view class="analysis">
      <text class="section-title">AI 详细分析</text>
      <!-- 降级：LLM 失败时展示 ASR 转写对比标注（降级矩阵 §5.6） -->
      <view v-if="stream.stage === 'error'" class="fallback">
        <text>AI 分析暂不可用，以下为转写原文：</text>
      </view>
      <text class="markdown">{{ stream.markdown }}</text>
    </view>

    <view class="actions">
      <button class="act-btn" @click="retry">↻ 再次练习</button>
      <button class="act-btn primary" @click="backToPlayer">返回精听 →</button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useTrainingStore } from '@/stores/training';

const trainingStore = useTrainingStore();
const stream = computed(() => trainingStore.reportStream);
const result = computed(() => stream.value.result);

const mode = ref<'shadowing' | 'recitation'>('shadowing');
let materialId = '';

onLoad((query) => {
  mode.value = (query?.mode as 'shadowing' | 'recitation') ?? 'shadowing';
  materialId = query?.materialId ?? '';
  uni.setNavigationBarTitle({ title: mode.value === 'shadowing' ? '分析报告 · 影子跟读' : '分析报告 · 全文背诵' });
});

const dims = computed(() => {
  const r = result.value;
  if (mode.value === 'recitation') {
    return [
      { label: '完整度', value: r?.completeness },
      { label: '准确度', value: r?.accuracy },
      { label: '流利度', value: r?.fluency }
    ];
  }
  return [
    { label: '完整度', value: r?.completeness },
    { label: '准确度', value: r?.accuracy },
    { label: '流利度', value: r?.fluency }
  ];
});

function retry(): void {
  const page = mode.value === 'shadowing' ? '/pages/training/shadowing' : '/pages/training/recitation';
  uni.redirectTo({ url: `${page}?materialId=${materialId}` });
}

/** 返回 P2 播放器（而非 P3），保证"训练完继续精听"动线最短（原型设计 §2.2） */
function backToPlayer(): void {
  uni.redirectTo({ url: `/pages/player/index?materialId=${materialId}` });
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}
.score-ring {
  display: flex;
  justify-content: center;
}
.ring {
  width: 220rpx;
  height: 220rpx;
  border-radius: 50%;
  border: 16rpx solid #3b6ef0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.score {
  font-size: 72rpx;
  font-weight: 700;
  color: #3b6ef0;
}
.label {
  font-size: 24rpx;
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
}
.dim-value {
  width: 60rpx;
  text-align: right;
}
.analysis {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
}
.section-title {
  font-size: 30rpx;
  font-weight: 600;
  display: block;
  margin-bottom: 16rpx;
}
.markdown {
  font-size: 26rpx;
  line-height: 1.8;
  white-space: pre-wrap;
}
.fallback {
  color: #e8890c;
  font-size: 22rpx;
  margin-bottom: 16rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
}
.act-btn {
  flex: 1;
  background: #f0f1f5;
  font-size: 28rpx;
  border-radius: 12rpx;
  &::after {
    border: none;
  }
  &.primary {
    background: #3b6ef0;
    color: #fff;
  }
}
</style>
