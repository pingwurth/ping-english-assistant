<template>
  <view class="page">
    <!-- 顶部操作区 -->
    <view class="header">
      <text class="title">材料库</text>
      <view class="actions">
        <button class="btn btn-secondary" @click="goTts">✍ 文字转语音</button>
        <button class="btn btn-primary" @click="goImport">＋ 导入材料</button>
      </view>
    </view>

    <!-- PC 端搜索/排序（移动端 MVP 不做，原型设计 §4.1） -->
    <!-- #ifdef H5 -->
    <view class="toolbar">
      <input v-model="keyword" class="search" placeholder="🔍 搜索材料名称…" />
      <picker :range="sortOptions" @change="onSortChange">
        <view class="sort-picker">排序: {{ sortOptions[sortIndex] }} ▾</view>
      </picker>
    </view>
    <!-- #endif -->

    <!-- 空态 -->
    <view v-if="filteredMaterials.length === 0" class="empty">
      <text class="empty-icon">📂</text>
      <text class="empty-text">还没有学习材料</text>
      <button class="btn btn-primary" @click="goImport">立即导入</button>
    </view>

    <!-- 材料卡片列表 -->
    <view v-else class="material-list">
      <view
        v-for="m in filteredMaterials"
        :key="m.id"
        class="material-card"
        @click="openMaterial(m.id)"
        @longpress="onLongPress(m)"
      >
        <text class="media-icon">{{ m.mediaType === 'video' ? '🎬' : '🎵' }}</text>
        <view class="info">
          <text class="name">{{ m.name }}</text>
          <text class="meta">
            {{ m.mediaType === 'video' ? '视频' : '音频' }} ·
            {{ m.subtitle ? (m.subtitle.isBilingual ? '双语' : '仅英文') : '无字幕' }} ·
            {{ formatMs(m.durationMs) }}
          </text>
          <view class="progress">
            <view class="progress-track">
              <view
                class="progress-fill"
                :style="{ width: `${progressOf(m)}%` }"
              />
            </view>
            <text class="progress-text">{{ progressOf(m) }}%</text>
          </view>
          <text class="last-open">{{ formatRelativeTime(m.lastOpenedAt) }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { useMaterialStore } from '@/stores/material';
import { useTrainingStore } from '@/stores/training';
import { formatMs, formatRelativeTime, progressPercent } from '@/utils/format';
import type { Material } from '@/types';

const materialStore = useMaterialStore();
const trainingStore = useTrainingStore();

const keyword = ref('');
const sortIndex = ref(0);
const sortOptions = ['最近学习', '名称'];

onShow(async () => {
  await materialStore.restore();
  await trainingStore.restoreRecords();
});

const filteredMaterials = computed(() => {
  let list = materialStore.materials;
  if (keyword.value.trim()) {
    const kw = keyword.value.trim().toLowerCase();
    list = list.filter((m) => m.name.toLowerCase().includes(kw));
  }
  if (sortIndex.value === 1) {
    list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  } else {
    list = [...list].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }
  return list;
});

function progressOf(m: Material): number {
  const p = materialStore.progressMap[m.id];
  const total = m.subtitle?.sentenceCount ?? 0;
  return progressPercent(p?.playedSentenceIndexes.length ?? 0, total);
}

function onSortChange(e: { detail: { value: string } }): void {
  sortIndex.value = Number(e.detail.value);
}

function openMaterial(id: string): void {
  uni.navigateTo({ url: `/pages/player/index?materialId=${id}` });
}

function goImport(): void {
  uni.navigateTo({ url: '/pages/import/index' });
}

function goTts(): void {
  uni.navigateTo({ url: '/pages/tts/index' });
}

/** 长按 → 重命名 / 删除（原型设计 §4.1） */
function onLongPress(m: Material): void {
  uni.showActionSheet({
    itemList: ['重命名', '删除'],
    success: ({ tapIndex }) => {
      if (tapIndex === 0) {
        // uni-app 无输入弹窗组件，简化为跳转编辑（可换自定义 modal）
        uni.showModal({
          title: '重命名材料',
          editable: true,
          placeholderText: m.name,
          success: (res) => {
            if (res.confirm && res.content?.trim()) {
              void materialStore.renameMaterial(m.id, res.content.trim());
            }
          }
        });
      } else if (tapIndex === 1) {
        uni.showModal({
          title: '删除材料',
          content: `确认删除「${m.name}」？媒体与字幕文件将一并移除。`,
          confirmColor: '#d83931',
          success: (res) => {
            if (res.confirm) void materialStore.removeMaterial(m.id);
          }
        });
      }
    }
  });
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1440px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}
.title {
  font-size: 40rpx;
  font-weight: 700;
}
.actions {
  display: flex;
  gap: 16rpx;
}
.btn {
  font-size: 26rpx;
  border-radius: 12rpx;
  padding: 0 28rpx;
  line-height: 64rpx;
  &::after {
    border: none;
  }
}
.btn-primary {
  background: #3b6ef0;
  color: #fff;
}
.btn-secondary {
  background: #eef2ff;
  color: #3b6ef0;
}
.toolbar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
}
.search {
  flex: 1;
  background: #fff;
  border-radius: 12rpx;
  padding: 16rpx 24rpx;
  font-size: 26rpx;
}
.sort-picker {
  background: #fff;
  border-radius: 12rpx;
  padding: 16rpx 24rpx;
  font-size: 26rpx;
  color: #646a73;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 160rpx 0;
  gap: 24rpx;
}
.empty-icon {
  font-size: 96rpx;
}
.empty-text {
  color: #8a9199;
}
.material-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.material-card {
  display: flex;
  gap: 24rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
}
.media-icon {
  font-size: 64rpx;
}
.info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.name {
  font-size: 30rpx;
  font-weight: 600;
}
.meta {
  font-size: 22rpx;
  color: #646a73;
}
.progress {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.progress-track {
  flex: 1;
  height: 10rpx;
  background: #f0f1f5;
  border-radius: 5rpx;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #3b6ef0;
}
.progress-text {
  font-size: 20rpx;
  color: #8a9199;
}
.last-open {
  font-size: 20rpx;
  color: #8a9199;
}
</style>
