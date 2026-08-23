<template>
  <view class="page">
    <view class="progress-info">
      <text>{{ sessionPos }}/{{ sessionTotal }}</text>
    </view>

    <!-- 句子卡片 -->
    <view class="sentence-card">
      <text v-if="subtitleMode !== 'zh'" class="en">{{ current?.textEn }}</text>
      <text v-if="subtitleMode !== 'en' && current?.textZh" class="zh">{{ current?.textZh }}</text>
      <view class="card-actions">
        <button class="mini-btn" @click="playOriginal">🔊 听原音</button>
        <button class="mini-btn" @click="cycleMode">{{ subtitleModeLabel }}</button>
      </view>
    </view>

    <!-- 录音按钮 -->
    <RecordButton
      ref="recordBtnRef"
      :mode="settingsStore.settings.recordMode"
      :processing="evaluating"
      :max-duration-ms="60000"
      @start="startRecord"
      @stop="stopRecord"
    />

    <!-- 评分结果 -->
    <ScorePanel v-if="report" class="result" :report="report" />
    <view v-if="report" class="actions">
      <button class="act-btn" @click="retry">↻ 再读一次</button>
      <button v-if="lastAudioSrc" class="act-btn" @click="playMyRecording">▶ 听我录音</button>
      <button class="act-btn primary" @click="next">下一句 →</button>
    </view>

    <!-- 无麦克风权限引导 -->
    <view v-if="permissionDenied" class="perm-mask">
      <view class="perm-card">
        <text>需要麦克风权限进行跟读评分</text>
        <button class="act-btn primary" @click="openSettings">去设置</button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMaterialStore } from '@/stores/material';
import { useSettingsStore } from '@/stores/settings';
import { useTrainingStore } from '@/stores/training';
import RecordButton from '@/components/training/RecordButton.vue';
import ScorePanel from '@/components/training/ScorePanel.vue';
import { createRecorder } from '@/platform/recorder';
import { createPlayer } from '@/platform/player';
import { getStorage } from '@/platform/storage';
import { evaluatePronunciation } from '@/services/soe-client';
import type { ScoreReport } from '@/core/training/scoring';
import type { RecordedAudio, RecorderController } from '@/core/recorder/types';
import type { PlayerController } from '@/core/player/types';
import type { SubtitleMode } from '@/stores/player';

const materialStore = useMaterialStore();
const settingsStore = useSettingsStore();
const trainingStore = useTrainingStore();

const session = computed(() => trainingStore.session);
const current = computed(() => session.value?.current ?? null);
const sessionPos = computed(() => (session.value?.position ?? 0) + 1);
const sessionTotal = computed(() => session.value?.total ?? 1);

const subtitleMode = ref<SubtitleMode>('both');
const subtitleModeLabel = computed(() => ({ both: '双语', en: '仅英', zh: '仅中', off: '字幕关' } as const)[subtitleMode.value]);

const recordBtnRef = ref<InstanceType<typeof RecordButton> | null>(null);
const evaluating = ref(false);
const report = ref<ScoreReport | null>(null);
const permissionDenied = ref(false);
const lastAudio = ref<RecordedAudio | null>(null);
const lastAudioSrc = ref('');

let recorder: RecorderController | null = null;
let originalPlayer: PlayerController | null = null;
let myPlayer: PlayerController | null = null;

onMounted(async () => {
  recorder = createRecorder();
  recorder.on('volume', (level) => recordBtnRef.value?.setVolume(level));
  recorder.on('maxreach', () => recordBtnRef.value?.forceStop());
  recorder.on('error', (err) => {
    if (err.code === 'permission-denied') permissionDenied.value = true;
    else uni.showToast({ title: err.message, icon: 'none' });
  });
  if (materialStore.currentMaterial) {
    originalPlayer = createPlayer('audio');
    const src = await getStorage().resolveFileSrc(materialStore.currentMaterial.mediaRef);
    await originalPlayer.load({ type: 'audio', src });
  }
});

async function playOriginal(): Promise<void> {
  const cur = current.value;
  if (!cur || !originalPlayer) return;
  originalPlayer.setLoop(cur.startMs, cur.endMs);
  originalPlayer.seekTo(cur.startMs);
  await originalPlayer.play();
  setTimeout(() => {
    originalPlayer?.clearLoop();
    originalPlayer?.pause();
  }, cur.endMs - cur.startMs + 300);
}

async function startRecord(): Promise<void> {
  if (!recorder) return;
  report.value = null;
  try {
    await recorder.start({ maxDurationMs: 60000 });
  } catch {
    recordBtnRef.value?.forceStop();
  }
}

/** 松开结束 → 上传评分 */
async function stopRecord(): Promise<void> {
  if (!recorder || !current.value) return;
  evaluating.value = true;
  try {
    const audio = await recorder.stop();
    lastAudio.value = audio;
    report.value = await evaluatePronunciation({
      audio: audio.blob ?? audio.tempFilePath ?? '',
      refText: current.value.textEn,
      fileName: 'read-aloud.wav'
    });
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '评分失败，可重试', icon: 'none' });
  } finally {
    evaluating.value = false;
  }
}

function retry(): void {
  report.value = null;
}

/** 回听本次录音（H5 Blob → ObjectURL；小程序临时文件路径直接播放） */
async function playMyRecording(): Promise<void> {
  if (!lastAudio.value) return;
  myPlayer?.destroy();
  myPlayer = createPlayer('audio');
  // #ifdef H5
  lastAudioSrc.value = lastAudio.value.blob ? URL.createObjectURL(lastAudio.value.blob) : '';
  // #endif
  // #ifdef MP-WEIXIN
  lastAudioSrc.value = lastAudio.value.tempFilePath ?? '';
  // #endif
  await myPlayer.load({ type: 'audio', src: lastAudioSrc.value });
  await myPlayer.play();
}

function next(): void {
  if (report.value && current.value) {
    session.value?.submit({ sentenceIndex: current.value.index, score: report.value.total });
  }
  report.value = null;
  lastAudio.value = null;
  lastAudioSrc.value = '';
  if (session.value?.done) {
    void finish();
  }
}

async function finish(): Promise<void> {
  const s = session.value?.summarize();
  const m = materialStore.currentMaterial;
  if (s && m) {
    await trainingStore.saveRecord({
      materialId: m.id,
      mode: 'read-aloud',
      scope: trainingStore.scope,
      score: s.averageScore,
      detail: { kind: 'read-aloud', averageScore: s.averageScore }
    });
  }
  uni.showToast({ title: `本轮平均 ${s?.averageScore ?? 0} 分`, icon: 'none' });
  uni.navigateBack();
}

function cycleMode(): void {
  const order: SubtitleMode[] = ['both', 'en', 'zh'];
  subtitleMode.value = order[(order.indexOf(subtitleMode.value) + 1) % order.length];
}

function openSettings(): void {
  // #ifdef MP-WEIXIN
  uni.openSetting();
  // #endif
  // #ifdef H5
  uni.showToast({ title: '请在浏览器地址栏开启麦克风权限', icon: 'none' });
  // #endif
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
.progress-info {
  font-size: 24rpx;
  color: #646a73;
}
.sentence-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
}
.sentence-card .en {
  font-size: 34rpx;
  font-weight: 600;
  display: block;
}
.sentence-card .zh {
  font-size: 26rpx;
  color: #646a73;
  display: block;
  margin-top: 8rpx;
}
.card-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}
.mini-btn {
  font-size: 24rpx;
  background: #f0f1f5;
  border-radius: 12rpx;
  padding: 0 24rpx;
  line-height: 56rpx;
  &::after {
    border: none;
  }
}
.result {
  margin-top: 8rpx;
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
.perm-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
}
.perm-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 48rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  align-items: center;
}
</style>
