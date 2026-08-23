<template>
  <view class="page">
    <!-- 提示模式选择 -->
    <view class="hint-mode">
      <text>提示模式:</text>
      <picker :range="availableHintModes" :value="hintModeIndex" @change="onHintModeChange">
        <view class="picker-value">{{ availableHintModes[hintModeIndex] }} ▾</view>
      </picker>
    </view>

    <!-- 提示列表 -->
    <scroll-view v-if="hintMode !== 'none'" class="hint-list" scroll-y>
      <view v-for="(s, i) in sentences" :key="s.index" class="hint-item">
        <text class="hint-index">{{ i + 1 }}.</text>
        <text class="hint-text">{{ hintTextOf(s) }}</text>
      </view>
    </scroll-view>

    <view class="record-area">
      <RecordButton
        ref="recordBtnRef"
        mode="tap"
        :max-duration-ms="600000"
        @start="startRecord"
        @stop="stopRecord"
      />
      <view class="actions">
        <button class="act-btn" :disabled="!recording" @click="pauseOrResume">
          {{ paused ? '▶ 继续' : '⏸ 暂停' }}
        </button>
        <button class="act-btn primary" :disabled="!recording && !paused" @click="finish">✓ 完成背诵</button>
      </view>
      <text class="note">说明: 背诵完成后将转写录音并与原文对比，评估完整度</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useMaterialStore } from '@/stores/material';
import { useTrainingStore } from '@/stores/training';
import RecordButton from '@/components/training/RecordButton.vue';
import { createRecorder } from '@/platform/recorder';
import { transcribe } from '@/services/dictation-asr';
import { postSse } from '@/services/sse';
import { API_BASE_URL } from '@/services/api-client';
import type { SubtitleSentence } from '@/core/subtitle';
import type { RecorderController } from '@/core/recorder/types';

const materialStore = useMaterialStore();
const trainingStore = useTrainingStore();

const sentences = computed(() => materialStore.subtitleData?.sentences ?? []);
const isBilingual = computed(() => materialStore.subtitleData?.isBilingual ?? false);

type HintMode = 'zh' | 'first-word' | 'none';
const hintMode = ref<HintMode>(isBilingual.value ? 'zh' : 'first-word');
const availableHintModes = computed(() => {
  const modes: { value: HintMode; label: string }[] = [];
  if (isBilingual.value) modes.push({ value: 'zh', label: '中文提示' });
  modes.push({ value: 'first-word', label: '首词提示' }, { value: 'none', label: '无提示' });
  return modes.map((m) => m.label);
});
const hintModeIndex = computed(() => {
  const values: HintMode[] = isBilingual.value ? ['zh', 'first-word', 'none'] : ['first-word', 'none'];
  return values.indexOf(hintMode.value);
});

const recordBtnRef = ref<InstanceType<typeof RecordButton> | null>(null);
const recording = ref(false);
const paused = ref(false);
let recorder: RecorderController | null = null;

function onHintModeChange(e: { detail: { value: string } }): void {
  const values: HintMode[] = isBilingual.value ? ['zh', 'first-word', 'none'] : ['first-word', 'none'];
  hintMode.value = values[Number(e.detail.value)];
}

function hintTextOf(s: SubtitleSentence): string {
  if (hintMode.value === 'zh') return s.textZh ?? '(无中文)';
  if (hintMode.value === 'first-word') return `${s.words[0] ?? ''}…`;
  return '';
}

async function startRecord(): Promise<void> {
  recorder = createRecorder();
  recorder.on('maxreach', () => finish());
  try {
    await recorder.start({ maxDurationMs: 600000 });
    recording.value = true;
    paused.value = false;
  } catch (e) {
    recordBtnRef.value?.forceStop();
    uni.showToast({ title: e instanceof Error ? e.message : '录音启动失败', icon: 'none' });
  }
}

function pauseOrResume(): void {
  if (!recorder) return;
  if (paused.value) {
    recorder.resume();
    paused.value = false;
  } else {
    recorder.pause();
    paused.value = true;
  }
}

async function stopRecord(): Promise<void> {
  // 点按模式下第二次点击 = 完成背诵
  if (recording.value) await finish();
}

async function finish(): Promise<void> {
  if (!recorder) return;
  recording.value = false;
  trainingStore.reportStream.stage = 'uploading';
  uni.showLoading({ title: '分析中…' });
  try {
    const audio = await recorder.stop();
    trainingStore.reportStream.stage = 'transcribing';
    const asr = await transcribe(audio.blob ?? audio.tempFilePath ?? '', 'recitation.wav');
    trainingStore.reportStream.stage = 'analyzing';
    await postSse(
      `${API_BASE_URL}/api/v1/reports/recitation`,
      {
        transcript: asr.text,
        sentences: sentences.value.map((s) => ({ index: s.index, textEn: s.textEn, textZh: s.textZh })),
        materialTitle: materialStore.currentMaterial?.name ?? ''
      },
      {
        onToken: (t) => {
          trainingStore.reportStream.markdown += t;
        },
        onResult: (r) => {
          trainingStore.reportStream.result = r;
        },
        onDone: () => {
          trainingStore.reportStream.stage = 'done';
          uni.hideLoading();
          uni.redirectTo({
            url: `/pages/training/report?mode=recitation&materialId=${materialStore.currentMaterial?.id ?? ''}`
          });
        },
        onError: (err) => {
          uni.hideLoading();
          trainingStore.reportStream.stage = 'error';
          uni.showToast({ title: err.message, icon: 'none' });
        }
      }
    );
  } catch (e) {
    uni.hideLoading();
    uni.showToast({ title: e instanceof Error ? e.message : '分析失败', icon: 'none' });
  }
}

onUnmounted(() => {
  recorder?.destroy();
});
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  height: 100vh;
  box-sizing: border-box;
}
.hint-mode {
  display: flex;
  align-items: center;
  gap: 16rpx;
  font-size: 26rpx;
}
.picker-value {
  background: #fff;
  border-radius: 12rpx;
  padding: 12rpx 24rpx;
}
.hint-list {
  flex: 1;
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  min-height: 200rpx;
}
.hint-item {
  display: flex;
  gap: 12rpx;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
}
.hint-index {
  color: #8a9199;
}
.record-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
  width: 100%;
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
  &[disabled] {
    opacity: 0.5;
  }
}
.note {
  font-size: 20rpx;
  color: #8a9199;
  text-align: center;
}
</style>
