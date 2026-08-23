<template>
  <view class="page">
    <!-- 准备态 -->
    <view v-if="phase === 'ready'">
      <view class="info-card">
        <text class="title">材料: {{ material?.name }}</text>
        <text class="meta">时长: {{ formatMs(material?.durationMs ?? 0) }} · {{ sentences.length }} 句</text>
      </view>
      <view v-if="settingsStore.settings.headphoneTipEnabled" class="tip-bar">
        <text>⚠ 建议佩戴耳机进行跟读，避免回声干扰</text>
        <text class="tip-close" @click="dismissTip">不再提示</text>
      </view>
      <button class="btn-start" @click="start">▶ 开始跟读</button>
    </view>

    <!-- 跟读中 -->
    <view v-else-if="phase === 'recording'" class="recording">
      <text class="status">▶ 播放中 {{ formatMs(playMs) }} / {{ formatMs(material?.durationMs ?? 0) }}</text>
      <text class="status recording-status">● 录音中 {{ formatMs(recordMs) }}</text>
      <slider :value="progress" :max="1000" disabled activeColor="#3b6ef0" />
      <!-- 当前句字幕显示可开关（默认关，避免"看读"代替"听读"） -->
      <view class="sentence-toggle">
        <switch :checked="showSentence" @change="showSentence = !showSentence" />
        <text>显示当前句</text>
      </view>
      <view v-if="showSentence && currentSentenceText" class="sentence-card">
        <text>{{ currentSentenceText }}</text>
      </view>
      <view class="actions">
        <button class="act-btn" @click="pause">⏸ 暂停</button>
        <button class="act-btn danger" @click="finishRecording">■ 结束分析</button>
      </view>
    </view>

    <!-- 分析中：分步进度 + SSE 流式渲染 -->
    <view v-else-if="phase === 'analyzing'" class="analyzing">
      <view class="step" :class="stepClass('uploading')">① 上传录音</view>
      <view class="step" :class="stepClass('transcribing')">② 语音转写</view>
      <view class="step" :class="stepClass('analyzing')">③ AI 分析中…</view>
      <view v-if="stream.markdown" class="stream-box">
        <text>{{ stream.markdown }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { useMaterialStore } from '@/stores/material';
import { useSettingsStore } from '@/stores/settings';
import { useTrainingStore } from '@/stores/training';
import { createRecorder } from '@/platform/recorder';
import { createPlayer } from '@/platform/player';
import { getStorage } from '@/platform/storage';
import { transcribe } from '@/services/dictation-asr';
import { postSse } from '@/services/sse';
import { API_BASE_URL } from '@/services/api-client';
import { formatMs } from '@/utils/format';
import type { RecordedAudio, RecorderController } from '@/core/recorder/types';
import type { PlayerController } from '@/core/player/types';

const materialStore = useMaterialStore();
const settingsStore = useSettingsStore();
const trainingStore = useTrainingStore();

const material = computed(() => materialStore.currentMaterial);
const sentences = computed(() => materialStore.subtitleData?.sentences ?? []);
const stream = computed(() => trainingStore.reportStream);

type Phase = 'ready' | 'recording' | 'analyzing';
const phase = ref<Phase>('ready');
const playMs = ref(0);
const recordMs = ref(0);
const showSentence = ref(false);
const currentSentenceText = ref('');

const progress = computed(() =>
  material.value?.durationMs ? Math.round((playMs.value / material.value.durationMs) * 1000) : 0
);

let recorder: RecorderController | null = null;
let player: PlayerController | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let recordStartedAt = 0;
let recordedAudio: RecordedAudio | null = null;

function stepClass(stage: string): string {
  const order = ['uploading', 'transcribing', 'analyzing'];
  const cur = order.indexOf(stream.value.stage);
  const mine = order.indexOf(stage);
  if (stream.value.stage === 'done') return 'done';
  if (mine < cur) return 'done';
  if (mine === cur) return 'active';
  return '';
}

function dismissTip(): void {
  void settingsStore.update({ headphoneTipEnabled: false });
}

/** 播放与录音同时启动（原型设计 §4.8） */
async function start(): Promise<void> {
  if (!material.value) return;
  player = createPlayer(material.value.mediaType);
  const src = await getStorage().resolveFileSrc(material.value.mediaRef);
  await player.load({ type: material.value.mediaType, src });

  recorder = createRecorder();
  recorder.on('maxreach', () => finishRecording());
  recorder.on('error', (err) => {
    uni.showToast({ title: err.message, icon: 'none' });
    pause();
  });

  try {
    await recorder.start({ maxDurationMs: 600000 });
  } catch {
    return;
  }
  await player.play();
  phase.value = 'recording';
  recordStartedAt = Date.now();
  ticker = setInterval(() => {
    playMs.value = player?.getCurrentTimeMs() ?? 0;
    recordMs.value = Date.now() - recordStartedAt;
    // 当前句文本（可选显示）
    const data = materialStore.subtitleData;
    if (data && showSentence.value) {
      const idx = data.sentences.findIndex((s) => playMs.value >= s.startMs && playMs.value < s.endMs);
      currentSentenceText.value = idx >= 0 ? data.sentences[idx].textEn : '';
    }
  }, 250);
}

function pause(): void {
  player?.pause();
  recorder?.pause();
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** 提前结束 → 停止播放与录音 → 上传分析（ADR-6 两段式） */
async function finishRecording(): Promise<void> {
  if (phase.value !== 'recording') return;
  player?.pause();
  if (ticker) clearInterval(ticker);
  ticker = null;
  phase.value = 'analyzing';
  trainingStore.reportStream.stage = 'uploading';

  try {
    recordedAudio = await recorder!.stop();
    trainingStore.reportStream.stage = 'transcribing';
    const asr = await transcribe(recordedAudio.blob ?? recordedAudio.tempFilePath ?? '', 'shadowing.wav');
    trainingStore.reportStream.stage = 'analyzing';

    await postSse(
      `${API_BASE_URL}/api/v1/reports/shadowing`,
      {
        transcript: asr.text,
        sentences: sentences.value.map((s) => ({ index: s.index, textEn: s.textEn, textZh: s.textZh })),
        materialTitle: material.value?.name ?? ''
      },
      {
        onStatus: (stage) => {
          trainingStore.reportStream.stage = stage as never;
        },
        onToken: (text) => {
          trainingStore.reportStream.markdown += text;
        },
        onResult: (result) => {
          trainingStore.reportStream.result = result;
        },
        onDone: () => {
          trainingStore.reportStream.stage = 'done';
          uni.redirectTo({
            url: `/pages/training/report?mode=shadowing&materialId=${material.value?.id ?? ''}`
          });
        },
        onError: (err) => {
          trainingStore.reportStream.stage = 'error';
          uni.showToast({ title: err.message, icon: 'none' });
          // 降级：本地保存录音可重试上传（降级矩阵 §5.6）
          phase.value = 'ready';
        }
      }
    );
  } catch (e) {
    trainingStore.reportStream.stage = 'error';
    uni.showToast({ title: e instanceof Error ? e.message : '分析失败，请重试', icon: 'none' });
    phase.value = 'ready';
  }
}

onUnmounted(() => {
  if (ticker) clearInterval(ticker);
  player?.destroy();
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
}
.info-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
}
.title {
  font-size: 30rpx;
  font-weight: 600;
  display: block;
}
.meta {
  font-size: 22rpx;
  color: #646a73;
}
.tip-bar {
  background: #fff7e6;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 24rpx;
  color: #e8890c;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tip-close {
  color: #8a9199;
  font-size: 22rpx;
}
.btn-start {
  background: #3b6ef0;
  color: #fff;
  font-size: 32rpx;
  border-radius: 12rpx;
  padding: 8rpx 0;
}
.status {
  font-size: 26rpx;
}
.recording-status {
  color: #d83931;
}
.sentence-toggle {
  display: flex;
  align-items: center;
  gap: 16rpx;
  font-size: 24rpx;
  color: #646a73;
}
.sentence-card {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 30rpx;
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
  &.danger {
    background: #d83931;
    color: #fff;
  }
}
.analyzing {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.step {
  font-size: 26rpx;
  color: #8a9199;
  &.active {
    color: #3b6ef0;
  }
  &.done {
    color: #2ea44f;
  }
}
.stream-box {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  font-size: 26rpx;
  min-height: 200rpx;
}
</style>
