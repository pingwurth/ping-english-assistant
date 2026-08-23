<template>
  <view class="page">
    <!-- ① 选择音视频文件 -->
    <view class="step">
      <text class="step-title">① 选择音视频文件 *</text>
      <view v-if="!mediaFile" class="picker-box" @click="chooseMedia">
        <text class="picker-icon">📁</text>
        <text class="picker-text">点击选择</text>
        <text class="picker-hint">支持 mp3 wav m4a mp4 mov 等</text>
      </view>
      <view v-else class="file-info">
        <text class="file-name">✓ {{ mediaFile.name }}</text>
        <text class="file-meta">{{ mediaTypeText }} · {{ formatBytes(mediaFile.size) }}</text>
        <text v-if="mediaFromTts" class="tts-badge">由文字转语音生成</text>
      </view>
    </view>

    <!-- ② 选择字幕文件 -->
    <view class="step">
      <text class="step-title">② 选择字幕文件 *</text>
      <view v-if="!subtitleFile" class="picker-box" @click="chooseSubtitle">
        <text class="picker-icon">📄</text>
        <text class="picker-text">点击选择</text>
        <text class="picker-hint">支持 .srt / .lrc</text>
      </view>
      <view v-else class="file-info">
        <text class="file-name">✓ {{ subtitleFile.name }}</text>
        <text v-if="parseSummary" class="file-ok">
          {{ parseSummary.format.toUpperCase() }} ·
          {{ parseSummary.isBilingual ? '双语字幕' : '单语字幕' }} ·
          {{ parseSummary.sentenceCount }} 句 · {{ formatMs(parseSummary.totalDurationMs) }}
          ✓解析成功
        </text>
        <text v-if="parseError" class="file-error">{{ parseError }}</text>
      </view>
      <!-- 字幕与媒体时长偏差警告（>5s 不阻断，原型设计 §3.1） -->
      <view v-if="durationMismatch" class="warning-bar">
        <text>⚠ 字幕末句 {{ formatMs(subtitleEndMs) }} 与媒体时长 {{ formatMs(mediaDurationMs) }} 略有偏差</text>
      </view>
    </view>

    <!-- ③ 材料名称 -->
    <view class="step">
      <text class="step-title">③ 材料名称</text>
      <input v-model="materialName" class="name-input" maxlength="50" placeholder="默认取文件名" />
    </view>

    <button class="btn-submit" :disabled="!canSubmit" @click="submit">完成导入</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { useMaterialStore } from '@/stores/material';
import { parseSubtitle, SubtitleParseError } from '@/core/subtitle';
import { formatBytes, formatMs } from '@/utils/format';
import { baseNameOf, isMediaFile, isSubtitleFile, mediaTypeOf } from '@/utils/file';
import { getStorage } from '@/platform/storage';

interface PickedFile {
  name: string;
  size: number;
  /** H5 Blob；小程序临时文件路径 */
  data: Blob | string;
}

const materialStore = useMaterialStore();

const mediaFile = ref<PickedFile | null>(null);
const subtitleFile = ref<PickedFile | null>(null);
const subtitleText = ref<string | null>(null);
const materialName = ref('');
const parseError = ref('');
const mediaFromTts = ref(false);
const submitting = ref(false);

interface ParseSummary {
  format: string;
  isBilingual: boolean;
  sentenceCount: number;
  totalDurationMs: number;
}
const parseSummary = ref<ParseSummary | null>(null);

const mediaDurationMs = ref(0);

/** TTS 一键带入（?source=tts&taskId=）：自动填充音频与字幕（原型设计 §4.2） */
onLoad(async (query) => {
  if (query?.source === 'tts' && query.taskId) {
    const task = materialStore.getTtsTask(query.taskId);
    if (task) {
      mediaFromTts.value = true;
      const storage = getStorage();
      // #ifdef H5
      const src = await storage.resolveFileSrc(task.audioRef);
      const blob = await fetch(src).then((r) => r.blob());
      mediaFile.value = { name: `tts-${task.voice}.wav`, size: blob.size, data: blob };
      // #endif
      // #ifdef MP-WEIXIN
      mediaFile.value = {
        name: `tts-${task.voice}.wav`,
        size: 0,
        data: task.audioRef
      };
      // #endif
      mediaDurationMs.value = task.durationMs;
      if (task.srt) {
        subtitleText.value = task.srt;
        subtitleFile.value = { name: `tts-${task.voice}.srt`, size: task.srt.length, data: '' };
        runParse(task.srt);
      }
      materialName.value = `TTS ${new Date(task.createdAt).toLocaleDateString()}`;
    }
  }
});

const mediaTypeText = computed(() =>
  mediaFile.value ? (mediaTypeOf(mediaFile.value.name) === 'video' ? '视频' : '音频') : ''
);

const canSubmit = computed(
  () => mediaFile.value != null && parseSummary.value != null && !submitting.value
);

/** 字幕末句与媒体时长偏差 >5s（原型设计 §3.1） */
const subtitleEndMs = computed(() => parseSummary.value?.totalDurationMs ?? 0);
const durationMismatch = computed(
  () =>
    parseSummary.value != null &&
    mediaDurationMs.value > 0 &&
    Math.abs(subtitleEndMs.value - mediaDurationMs.value) > 5000
);

function chooseMedia(): void {
  // #ifdef H5
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    if (!isMediaFile(f.name)) {
      uni.showToast({ title: '该格式可能无法播放', icon: 'none' });
    }
    mediaFile.value = { name: f.name, size: f.size, data: f };
    materialName.value = materialName.value || baseNameOf(f.name);
    probeMediaDuration(f);
  };
  input.click();
  // #endif
  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['mp3', 'wav', 'm4a', 'mp4', 'mov'],
    success: (res) => {
      const f = res.tempFiles[0];
      mediaFile.value = { name: f.name, size: f.size, data: f.path };
      materialName.value = materialName.value || baseNameOf(f.name);
    }
  });
  // #endif
}

function chooseSubtitle(): void {
  // #ifdef H5
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.srt,.lrc';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    if (!isSubtitleFile(f.name)) {
      parseError.value = '仅支持 .srt / .lrc 字幕文件';
      return;
    }
    const text = await f.text();
    subtitleFile.value = { name: f.name, size: f.size, data: f };
    subtitleText.value = text;
    runParse(text);
  };
  input.click();
  // #endif
  // #ifdef MP-WEIXIN
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['srt', 'lrc'],
    success: async (res) => {
      const f = res.tempFiles[0];
      subtitleFile.value = { name: f.name, size: f.size, data: f.path };
      try {
        const fs = uni.getFileSystemManager();
        const text = await new Promise<string>((resolve, reject) => {
          fs.readFile({
            filePath: f.path,
            encoding: 'utf8',
            success: (r) => resolve(String(r.data)),
            fail: (e) => reject(new Error(e.errMsg))
          });
        });
        subtitleText.value = text;
        runParse(text);
      } catch (e) {
        parseError.value = e instanceof Error ? e.message : '字幕读取失败';
      }
    }
  });
  // #endif
}

/** 选择字幕文件后即时解析（纯前端自研解析器，零网络请求） */
function runParse(text: string): void {
  parseError.value = '';
  parseSummary.value = null;
  try {
    const data = parseSubtitle(text, undefined, subtitleFile.value?.name);
    parseSummary.value = {
      format: data.format,
      isBilingual: data.isBilingual,
      sentenceCount: data.sentences.length,
      totalDurationMs: data.totalDurationMs
    };
  } catch (e) {
    parseError.value =
      e instanceof SubtitleParseError ? e.message : '字幕解析失败，请检查文件内容';
  }
}

/** H5：用临时 video/audio 元素探测媒体时长 */
function probeMediaDuration(file: Blob): void {
  // #ifdef H5
  const url = URL.createObjectURL(file);
  const el = document.createElement(mediaTypeOf(mediaFile.value!.name) === 'video' ? 'video' : 'audio');
  el.preload = 'metadata';
  el.onloadedmetadata = () => {
    mediaDurationMs.value = el.duration * 1000;
    URL.revokeObjectURL(url);
  };
  el.src = url;
  // #endif
}

async function submit(): Promise<void> {
  if (!canSubmit.value || !mediaFile.value) return;
  submitting.value = true;
  try {
    const material = await materialStore.importMaterial({
      mediaFile: mediaFile.value.data,
      mediaFileName: mediaFile.value.name,
      mediaSizeBytes: mediaFile.value.size,
      subtitleText: subtitleText.value,
      subtitleFileName: subtitleFile.value?.name,
      name: materialName.value
    });
    // 完成导入 → 自动进入 P2 播放器（原型设计 §3.1）
    uni.redirectTo({ url: `/pages/player/index?materialId=${material.id}` });
  } catch (e) {
    uni.showToast({
      title: e instanceof Error ? e.message : '导入失败',
      icon: 'none'
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 960rpx;
  margin: 0 auto;
}
.step {
  margin-bottom: 32rpx;
}
.step-title {
  font-size: 28rpx;
  font-weight: 600;
  display: block;
  margin-bottom: 16rpx;
}
.picker-box {
  border: 2rpx dashed #c0c4cc;
  border-radius: 20rpx;
  padding: 48rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}
.picker-icon {
  font-size: 64rpx;
}
.picker-text {
  font-size: 28rpx;
  color: #1f2329;
}
.picker-hint {
  font-size: 22rpx;
  color: #8a9199;
}
.file-info {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.file-name {
  font-size: 28rpx;
}
.file-meta {
  font-size: 22rpx;
  color: #646a73;
}
.tts-badge {
  font-size: 20rpx;
  color: #3b6ef0;
  background: #eef2ff;
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
  align-self: flex-start;
}
.file-ok {
  font-size: 22rpx;
  color: #2ea44f;
}
.file-error {
  font-size: 22rpx;
  color: #d83931;
}
.warning-bar {
  margin-top: 16rpx;
  background: #fff7e6;
  border-radius: 12rpx;
  padding: 16rpx 24rpx;
  font-size: 22rpx;
  color: #e8890c;
}
.name-input {
  background: #fff;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
}
.btn-submit {
  background: #3b6ef0;
  color: #fff;
  border-radius: 12rpx;
  font-size: 30rpx;
  &[disabled] {
    background: #c0c4cc;
  }
}
</style>
