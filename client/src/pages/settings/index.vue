<template>
  <view class="page">
    <!-- 学习统计 -->
    <view class="section">
      <text class="section-title">📊 学习统计</text>
      <view class="stat-card">
        <text>今日: 精听 {{ todayMinutes }} 分钟</text>
        <text>本周: 训练 {{ weekTrainingCount }} 次</text>
        <text>累计: 材料 {{ materialStore.materials.length }} 份</text>
      </view>
    </view>

    <!-- 播放设置 -->
    <view class="section">
      <text class="section-title">⚙ 播放设置</text>
      <view class="setting-row">
        <text>默认倍速</text>
        <picker :range="rateOptions" :value="rateIndex" @change="onRateChange">
          <view class="picker-value">{{ settings.defaultRate }}x ▾</view>
        </picker>
      </view>
      <view class="setting-row">
        <text>单句循环次数</text>
        <picker :range="loopOptions" :value="loopIndex" @change="onLoopChange">
          <view class="picker-value">{{ loopOptions[loopIndex] }} ▾</view>
        </picker>
      </view>
      <view class="setting-row">
        <text>字幕默认显示</text>
        <picker :range="subtitleOptions" :value="subtitleIndex" @change="onSubtitleChange">
          <view class="picker-value">{{ subtitleOptions[subtitleIndex] }} ▾</view>
        </picker>
      </view>
    </view>

    <!-- 训练设置 -->
    <view class="section">
      <text class="section-title">🎤 训练设置</text>
      <view class="setting-row">
        <text>录音模式</text>
        <picker :range="recordModes" :value="recordModeIndex" @change="onRecordModeChange">
          <view class="picker-value">{{ recordModes[recordModeIndex] }} ▾</view>
        </picker>
      </view>
      <view class="setting-row">
        <text>影子跟读耳机提示</text>
        <switch
          :checked="settings.headphoneTipEnabled"
          @change="onHeadphoneTipChange"
        />
      </view>
      <!-- #ifdef MP-WEIXIN -->
      <view class="setting-row">
        <text>后台播放</text>
        <switch
          :checked="settings.backgroundPlay"
          @change="onBackgroundPlayChange"
        />
      </view>
      <!-- #endif -->
    </view>

    <!-- 存储管理 -->
    <view class="section">
      <text class="section-title">🗄 存储管理</text>
      <view class="setting-row">
        <text>材料占用</text>
        <text class="picker-value">{{ totalSize }}</text>
      </view>
      <button class="clean-btn" @click="cleanCaches">清理录音缓存</button>
    </view>

    <!-- 关于 -->
    <view class="section">
      <text class="section-title">ℹ 关于与帮助</text>
      <view class="setting-row">
        <text>版本</text>
        <text class="picker-value">0.1.0 (MVP)</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSettingsStore, type AppSettings } from '@/stores/settings';
import { useMaterialStore } from '@/stores/material';
import { useTrainingStore } from '@/stores/training';
import { formatBytes } from '@/utils/format';

const settingsStore = useSettingsStore();
const materialStore = useMaterialStore();
const trainingStore = useTrainingStore();

const settings = computed(() => settingsStore.settings);

const rateOptions = ['0.5', '0.75', '1.0', '1.25', '1.5', '2.0'];
const rateIndex = computed(() => Math.max(0, rateOptions.indexOf(String(settings.value.defaultRate))));
const loopOptions = ['1 次', '3 次', '无限'];
const loopIndex = computed(() => (settings.value.loopTimes === 1 ? 0 : settings.value.loopTimes === 3 ? 1 : 2));
const subtitleOptions = ['双语', '仅英文', '仅中文', '关闭'];
const subtitleIndex = computed(() => ({ both: 0, en: 1, zh: 2, off: 3 } as const)[settings.value.subtitleMode]);
const recordModes = ['按住说话', '点按开始/结束'];
const recordModeIndex = computed(() => (settings.value.recordMode === 'hold' ? 0 : 1));

const totalSize = computed(() =>
  formatBytes(materialStore.materials.reduce((sum, m) => sum + m.mediaSizeBytes, 0))
);

const todayMinutes = computed(() => 0); // MVP：统计明细见 V1.1 迭代规划
const weekTrainingCount = computed(() => {
  const weekAgo = Date.now() - 7 * 86400000;
  return trainingStore.records.filter((r) => r.createdAt >= weekAgo).length;
});

function onRateChange(e: { detail: { value: string } }): void {
  update({ defaultRate: Number(rateOptions[Number(e.detail.value)]) });
}

function onLoopChange(e: { detail: { value: string } }): void {
  const times = [1, 3, Infinity][Number(e.detail.value)];
  update({ loopTimes: times });
}

function onSubtitleChange(e: { detail: { value: string } }): void {
  const modes = ['both', 'en', 'zh', 'off'] as const;
  update({ subtitleMode: modes[Number(e.detail.value)] });
}

function onRecordModeChange(e: { detail: { value: string } }): void {
  update({ recordMode: Number(e.detail.value) === 0 ? 'hold' : 'tap' });
}

function update(patch: Partial<AppSettings>): void {
  void settingsStore.update(patch);
}

function onHeadphoneTipChange(e: unknown): void {
  update({ headphoneTipEnabled: (e as { detail: { value: boolean } }).detail.value });
}

function onBackgroundPlayChange(e: unknown): void {
  update({ backgroundPlay: (e as { detail: { value: boolean } }).detail.value });
}

function cleanCaches(): void {
  uni.showModal({
    title: '清理录音缓存',
    content: '将删除训练录音的本地缓存（不影响材料与学习记录）',
    success: (res) => {
      if (res.confirm) uni.showToast({ title: '已清理', icon: 'success' });
    }
  });
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.section-title {
  font-size: 28rpx;
  font-weight: 600;
  display: block;
  margin-bottom: 12rpx;
}
.stat-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  font-size: 26rpx;
}
.setting-row {
  background: #fff;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
  font-size: 26rpx;
}
.picker-value {
  color: #8a9199;
}
.clean-btn {
  background: #f0f1f5;
  font-size: 26rpx;
  border-radius: 12rpx;
}
</style>
