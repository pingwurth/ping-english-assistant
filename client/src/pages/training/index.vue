<template>
  <view class="page">
    <view class="material-info">
      <text class="material-name">材料: {{ material?.name ?? '-' }}</text>
      <!-- 范围选择：全文 / 收藏句（收藏句为 0 时禁用，原型设计 §4.4） -->
      <picker :range="scopeOptions" :disabled="favoriteCount === 0" @change="onScopeChange">
        <view class="scope-picker" :class="{ disabled: favoriteCount === 0 }">
          范围: {{ scopeOptions[scopeIndex] }} ▾
        </view>
      </picker>
      <text v-if="favoriteCount === 0" class="scope-hint">先去精听页收藏句子</text>
    </view>

    <view class="mode-list">
      <view
        v-for="mode in modes"
        :key="mode.key"
        class="mode-card"
        :class="{ disabled: mode.disabled }"
        @click="enterMode(mode)"
      >
        <text class="mode-icon">{{ mode.icon }}</text>
        <view class="mode-info">
          <text class="mode-name">{{ mode.name }}</text>
          <text class="mode-desc">{{ mode.desc }}</text>
          <text class="mode-score">{{ lastScoreText(mode.key) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { useMaterialStore } from '@/stores/material';
import { useTrainingStore } from '@/stores/training';
import type { TrainingMode } from '@/core/training/session';

const materialStore = useMaterialStore();
const trainingStore = useTrainingStore();

const material = computed(() => materialStore.currentMaterial);
const sentences = computed(() => materialStore.subtitleData?.sentences ?? []);

const scopeIndex = ref(0);
const favoriteCount = computed(() =>
  material.value ? materialStore.favoritesOf(material.value.id).length : 0
);
const scopeOptions = computed(() => [
  `全文 ${sentences.value.length} 句`,
  `收藏句 ${favoriteCount.value} 句`
]);

interface ModeItem {
  key: TrainingMode;
  icon: string;
  name: string;
  desc: string;
  page: string;
  /** 影子跟读/全文背诵始终使用全文范围，选"收藏句"时置灰 */
  fulltextOnly?: boolean;
  disabled?: boolean;
}

const modes = computed<ModeItem[]>(() =>
  ([
    { key: 'puzzle', icon: '🧩', name: '九宫格', desc: '选词拼句 · 巩固句型结构', page: '/pages/training/puzzle' },
    { key: 'dictation', icon: '✍️', name: '单句听写', desc: '听音写句 · 提升听辨', page: '/pages/training/dictation' },
    { key: 'read-aloud', icon: '🎤', name: '跟读评分', desc: '逐句跟读 · AI 发音评分', page: '/pages/training/read-aloud' },
    { key: 'shadowing', icon: '🗣️', name: '影子跟读', desc: '全文同步跟读 · LLM 分析', page: '/pages/training/shadowing', fulltextOnly: true },
    { key: 'recitation', icon: '📖', name: '全文背诵', desc: '背诵全文 · LLM 评估建议', page: '/pages/training/recitation', fulltextOnly: true }
  ] as ModeItem[]).map((m) => ({
    ...m,
    disabled: m.fulltextOnly === true && scopeIndex.value === 1
  }))
);

onLoad(async (query) => {
  const materialId = query?.materialId;
  if (materialId && materialStore.currentMaterial?.id !== materialId) {
    await materialStore.openMaterial(materialId);
  }
});

onShow(async () => {
  await trainingStore.restoreRecords();
});

function onScopeChange(e: { detail: { value: string } }): void {
  scopeIndex.value = Number(e.detail.value);
}

function lastScoreText(mode: TrainingMode): string {
  if (!material.value) return '尚未练习';
  const score = trainingStore.lastScoreOf(material.value.id, mode);
  return score == null ? '尚未练习' : `上次: ${score} 分`;
}

function enterMode(mode: ModeItem): void {
  if (mode.disabled || !material.value) return;
  const scope =
    scopeIndex.value === 1 ? ({ type: 'favorites' } as const) : ({ type: 'all' } as const);
  const pool =
    scope.type === 'favorites'
      ? materialStore.favoritesOf(material.value.id).map((i) => sentences.value[i]).filter(Boolean)
      : sentences.value;
  trainingStore.startSession(mode.key, pool, scope);
  uni.navigateTo({ url: `${mode.page}?materialId=${material.value.id}` });
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
}
.material-info {
  margin-bottom: 32rpx;
}
.material-name {
  font-size: 30rpx;
  font-weight: 600;
  display: block;
  margin-bottom: 12rpx;
}
.scope-picker {
  background: #fff;
  border-radius: 12rpx;
  padding: 16rpx 24rpx;
  font-size: 26rpx;
  &.disabled {
    color: #c0c4cc;
  }
}
.scope-hint {
  font-size: 20rpx;
  color: #8a9199;
  display: block;
  margin-top: 8rpx;
}
.mode-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.mode-card {
  display: flex;
  gap: 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 28rpx 24rpx;
  align-items: center;
  &.disabled {
    opacity: 0.45;
  }
}
.mode-icon {
  font-size: 56rpx;
}
.mode-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.mode-name {
  font-size: 30rpx;
  font-weight: 600;
}
.mode-desc {
  font-size: 22rpx;
  color: #646a73;
}
.mode-score {
  font-size: 20rpx;
  color: #8a9199;
}
</style>
