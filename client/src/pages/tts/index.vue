<template>
  <view class="page">
    <!-- 文本输入 -->
    <text class="section-label">输入英文文本:</text>
    <textarea
      v-model="text"
      class="text-input"
      :maxlength="5000"
      placeholder="You should answer the questions as you..."
      :disabled="generating"
    />
    <view class="char-count">
      <text>{{ text.length }} / 5000 字</text>
      <text v-if="!isEnglish && text" class="warn">当前语音模型针对英文优化</text>
    </view>

    <!-- 声音选择 -->
    <view class="option-row">
      <text>声音:</text>
      <picker :range="voiceLabels" :value="voiceIndex" @change="onVoiceChange">
        <view class="picker-value">{{ voiceLabels[voiceIndex] }} ▾</view>
      </picker>
      <button class="mini-btn" :disabled="previewing" @click="preview">
        {{ previewing ? '合成中…' : '🔊 试听' }}
      </button>
    </view>

    <!-- 语速 -->
    <view class="option-row">
      <text>语速:</text>
      <slider
        class="speed-slider"
        :value="speed"
        :min="0.5"
        :max="2"
        :step="0.05"
        activeColor="#3b6ef0"
        show-value
        @change="onSpeedChange"
      />
    </view>

    <!-- 字幕开关 -->
    <view class="option-row">
      <checkbox :checked="withSubtitle" @change="withSubtitle = !withSubtitle" />
      <text>同时生成字幕（SRT）</text>
    </view>

    <button class="btn-generate" :disabled="!text.trim() || generating" @click="generate">
      ⚡ 开始生成
    </button>

    <!-- 生成中 -->
    <view v-if="generating" class="generating">
      <text>合成中…（5000 字约需 10-30s）</text>
      <button class="mini-btn" @click="cancel">取消</button>
    </view>

    <!-- 生成完成 -->
    <view v-if="generated" class="result">
      <view class="play-row">
        <button class="mini-btn primary" @click="togglePreview">{{ playing ? '⏸' : '▶' }}</button>
        <text class="duration">{{ formatMs(generated.durationMs) }} · {{ generated.sentenceCount }} 句</text>
      </view>

      <button class="btn-save" @click="saveToDevice">💾 保存到设备</button>
      <view v-if="savedLocation" class="saved-info">
        <text>✅ 已保存: {{ savedLocation }}</text>
        <text v-if="withSubtitle" class="sub">（含同名 .srt 字幕文件）</text>
      </view>

      <button class="btn-import" @click="importAsMaterial">📥 导入为学习材料</button>
      <text class="import-hint">导入后可直接逐句精听与训练，字幕已按句自动对齐</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { generateTts, fetchTtsSubtitle, previewVoice, TTS_VOICES } from '@/services/tts-client';
import { createFileSaver } from '@/platform/saver';
import { getStorage } from '@/platform/storage';
import { useMaterialStore } from '@/stores/material';
import { isMostlyEnglish } from '@/utils/cjk';
import { formatMs } from '@/utils/format';
import { genId } from '@/utils/id';
import { createPlayer } from '@/platform/player';
import type { PlayerController } from '@/core/player/types';

const materialStore = useMaterialStore();

const text = ref('');
const voiceIndex = ref(0);
const speed = ref(1.0);
const withSubtitle = ref(true);
const generating = ref(false);
const previewing = ref(false);
const savedLocation = ref('');
const playing = ref(false);

interface Generated {
  taskId: string;
  audioRef: string;
  srt: string | null;
  durationMs: number;
  sentenceCount: number;
}
const generated = ref<Generated | null>(null);

const voiceLabels = TTS_VOICES.map((v) => v.label);
const isEnglish = computed(() => isMostlyEnglish(text.value));

let cancelled = false;
let previewPlayer: PlayerController | null = null;

function onVoiceChange(e: { detail: { value: string } }): void {
  voiceIndex.value = Number(e.detail.value);
}

function onSpeedChange(e: { detail: { value: number } }): void {
  speed.value = e.detail.value;
}

/** 试听小样：现场合成一句固定文本 */
async function preview(): Promise<void> {
  previewing.value = true;
  try {
    const out = await previewVoice(TTS_VOICES[voiceIndex.value].id);
    await playArrayBuffer(out.arrayBuffer!);
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '试听失败', icon: 'none' });
  } finally {
    previewing.value = false;
  }
}

/** 生成：分句合成 + 同步生成 SRT 字幕（架构文档 §5.5） */
async function generate(): Promise<void> {
  generating.value = true;
  cancelled = false;
  savedLocation.value = '';
  try {
    const out = await generateTts({
      text: text.value,
      voice: TTS_VOICES[voiceIndex.value].id,
      speed: speed.value,
      format: 'wav',
      withSubtitle: withSubtitle.value
    });
    if (cancelled) return;

    // 领取字幕（withSubtitle=true 时）
    let srt: string | null = null;
    if (withSubtitle.value && out.taskId) {
      try {
        srt = (await fetchTtsSubtitle(out.taskId)).srt;
      } catch {
        // 字幕生成失败时仍可只保存音频（降级矩阵 §5.6）
        uni.showToast({ title: '字幕生成失败，可只保存音频', icon: 'none' });
      }
    }

    // 音频落端内缓存（生成记录 24h，支持重复导入）
    const storage = getStorage();
    let audioRef: string;
    // #ifdef H5
    {
      const blob = new Blob([out.arrayBuffer!], { type: 'audio/wav' });
      audioRef = await storage.saveFile(blob, `tts-${out.taskId}.wav`);
    }
    // #endif
    // #ifdef MP-WEIXIN
    // 小程序：arraybuffer 写入临时文件
    audioRef = await writeArrayBufferToFile(out.arrayBuffer!, `tts-${out.taskId}.wav`);
    // #endif

    generated.value = {
      taskId: out.taskId,
      audioRef,
      srt,
      durationMs: out.durationMs,
      sentenceCount: out.sentenceCount
    };

    // 记录到端内缓存
    await materialStore.cacheTtsTask({
      taskId: out.taskId || genId(),
      text: text.value,
      voice: TTS_VOICES[voiceIndex.value].id,
      speed: speed.value,
      audioRef,
      srt,
      durationMs: out.durationMs,
      sentenceCount: out.sentenceCount,
      createdAt: Date.now()
    });
  } catch (e) {
    if (!cancelled) {
      uni.showToast({ title: e instanceof Error ? e.message : '生成失败，请重试', icon: 'none' });
    }
  } finally {
    generating.value = false;
  }
}

function cancel(): void {
  cancelled = true;
  generating.value = false;
}

/** 保存到设备：音频（勾选字幕时一并保存 .srt），完成后就地展示存放位置 */
async function saveToDevice(): Promise<void> {
  if (!generated.value) return;
  const saver = createFileSaver();
  try {
    const fileName = `tts-${TTS_VOICES[voiceIndex.value].id}-${dateStamp()}`;
    const storage = getStorage();
    let saved: { locationText: string; localRef: string };
    // #ifdef H5
    {
      const src = await storage.resolveFileSrc(generated.value.audioRef);
      saved = await saver.saveAudio(src, `${fileName}.wav`);
    }
    // #endif
    // #ifdef MP-WEIXIN
    saved = await saver.saveAudio(generated.value.audioRef, `${fileName}.wav`);
    // #endif
    let locationText = saved.locationText;
    if (withSubtitle.value && generated.value.srt) {
      const rs = await saver.saveText(generated.value.srt, `${fileName}.srt`);
      locationText += `\n字幕: ${rs.locationText}`;
    }
    savedLocation.value = locationText;
  } catch (e) {
    uni.showToast({ title: e instanceof Error ? e.message : '保存失败', icon: 'none' });
  }
}

/** 一键导入为学习材料：跳转 P1 并自动填充（架构文档 §5.5） */
function importAsMaterial(): void {
  if (!generated.value) return;
  uni.navigateTo({
    url: `/pages/import/index?source=tts&taskId=${materialStore.ttsTasks[0]?.taskId ?? generated.value.taskId}`
  });
}

async function togglePreview(): Promise<void> {
  if (!generated.value) return;
  if (playing.value) {
    previewPlayer?.pause();
    playing.value = false;
    return;
  }
  previewPlayer?.destroy();
  previewPlayer = createPlayer('audio');
  const src = await getStorage().resolveFileSrc(generated.value.audioRef);
  await previewPlayer.load({ type: 'audio', src });
  previewPlayer.on('ended', () => (playing.value = false));
  await previewPlayer.play();
  playing.value = true;
}

async function playArrayBuffer(buf: ArrayBuffer): Promise<void> {
  previewPlayer?.destroy();
  previewPlayer = createPlayer('audio');
  let previewSrc: string;
  // #ifdef H5
  previewSrc = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  // #endif
  // #ifdef MP-WEIXIN
  previewSrc = await writeArrayBufferToFile(buf, 'preview.wav');
  // #endif
  await previewPlayer.load({ type: 'audio', src: previewSrc });
  await previewPlayer.play();
  previewPlayer.on('ended', () => (playing.value = false));
}

// #ifdef MP-WEIXIN
function writeArrayBufferToFile(buf: ArrayBuffer, fileName: string): Promise<string> {
  const fs = uni.getFileSystemManager();
  const path = `${(uni as unknown as { env: { USER_DATA_PATH: string } }).env.USER_DATA_PATH}/${fileName}`;
  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath: path,
      data: buf,
      success: () => resolve(path),
      fail: (err) => reject(new Error(err.errMsg))
    });
  });
}
// #endif

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

onUnmounted(() => {
  previewPlayer?.destroy();
});
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.section-label {
  font-size: 26rpx;
  color: #646a73;
}
.text-input {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  width: 100%;
  box-sizing: border-box;
  min-height: 240rpx;
  font-size: 30rpx;
}
.char-count {
  display: flex;
  justify-content: space-between;
  font-size: 22rpx;
  color: #8a9199;
}
.warn {
  color: #e8890c;
}
.option-row {
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
.mini-btn {
  font-size: 22rpx;
  background: #f0f1f5;
  border-radius: 12rpx;
  padding: 0 20rpx;
  line-height: 48rpx;
  &::after {
    border: none;
  }
  &.primary {
    background: #3b6ef0;
    color: #fff;
  }
}
.speed-slider {
  flex: 1;
}
.btn-generate {
  background: #3b6ef0;
  color: #fff;
  font-size: 32rpx;
  border-radius: 12rpx;
  &[disabled] {
    background: #c0c4cc;
  }
}
.generating {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  color: #646a73;
  font-size: 26rpx;
}
.result {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.play-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.duration {
  font-size: 24rpx;
  color: #646a73;
}
.btn-save {
  background: #2ea44f;
  color: #fff;
  border-radius: 12rpx;
  font-size: 28rpx;
}
.saved-info {
  font-size: 22rpx;
  color: #2ea44f;
  display: flex;
  flex-direction: column;
}
.sub {
  color: #8a9199;
}
.btn-import {
  background: #3b6ef0;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
}
.import-hint {
  font-size: 20rpx;
  color: #8a9199;
  text-align: center;
}
</style>
