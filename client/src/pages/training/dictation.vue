<template>
  <view class="page">
    <view class="progress-info">
      <text>{{ sessionPos }}/{{ sessionTotal }}</text>
    </view>

    <view class="play-card">
      <button class="play-btn" @click="replay">▶ 🔊 播放句子</button>
      <text class="play-count">已播放 {{ playCount }} 次 · {{ playerStore.rate }}x</text>
    </view>

    <text class="section-label">听写输入:</text>
    <textarea
      v-model="input"
      class="dictation-input"
      placeholder="听到什么写什么…"
      :disabled="checked"
      auto-height
    />

    <view class="actions">
      <button class="act-btn" @click="input = ''">🗑 清空</button>
      <button class="act-btn primary" :disabled="!input.trim() || checked" @click="check">✓ 核对答案</button>
    </view>

    <!-- 核对结果：逐词 diff 着色（原型设计 §4.6） -->
    <view v-if="tokens.length" class="diff-result">
      <text class="section-label">你的答案 vs 原文:</text>
      <view class="tokens">
        <text
          v-for="(t, i) in tokens"
          :key="i"
          class="token"
          :class="`token-${t.type}`"
        >{{ t.type === 'missing' ? t.target : (t.input ?? t.target) }}</text>
      </view>
      <text class="accuracy">本句正确率 {{ accuracy }}%</text>
      <view class="actions">
        <button class="act-btn" @click="replay">🔊 重听</button>
        <button class="act-btn" @click="rewrite">↻ 重写</button>
        <button class="act-btn primary" @click="next">下一句 →</button>
      </view>
    </view>

    <!-- 小结浮层 -->
    <view v-if="summary" class="result-mask">
      <view class="result-card">
        <text class="summary-title">本轮完成</text>
        <text>平均正确率 {{ summary.averageScore }}%</text>
        <text class="summary-sub">总播放 {{ totalPlayCount }} 次</text>
        <view v-if="summary.weakest.length" class="weakest">
          <text class="section-label">最弱句 TOP{{ summary.weakest.length }}:</text>
          <text v-for="w in summary.weakest" :key="w.sentenceIndex" class="weakest-item">
            第 {{ w.sentenceIndex + 1 }} 句 · {{ w.score }}%
          </text>
        </view>
        <view class="actions">
          <button class="act-btn" @click="restart">再来一轮</button>
          <button class="act-btn primary" @click="back">返回</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useMaterialStore } from '@/stores/material';
import { usePlayerStore } from '@/stores/player';
import { useTrainingStore } from '@/stores/training';
import { accuracyOf, diffWords, type DiffToken } from '@/core/training/dictation-diff';
import type { SessionSummary } from '@/core/training/session';
import { createPlayer } from '@/platform/player';
import { getStorage } from '@/platform/storage';
import type { PlayerController } from '@/core/player/types';

const materialStore = useMaterialStore();
const playerStore = usePlayerStore();
const trainingStore = useTrainingStore();

const session = computed(() => trainingStore.session);
const sessionPos = computed(() => (session.value?.position ?? 0) + 1);
const sessionTotal = computed(() => session.value?.total ?? 1);

const input = ref('');
const checked = ref(false);
const tokens = ref<DiffToken[]>([]);
const accuracy = ref(0);
const playCount = ref(0);
const totalPlayCount = ref(0);
const summary = ref<SessionSummary | null>(null);

let audio: PlayerController | null = null;

onMounted(async () => {
  if (!materialStore.currentMaterial) return;
  audio = createPlayer('audio');
  const src = await getStorage().resolveFileSrc(materialStore.currentMaterial.mediaRef);
  await audio.load({ type: 'audio', src });
});

async function replay(): Promise<void> {
  const cur = session.value?.current;
  if (!cur || !audio) return;
  playCount.value++;
  totalPlayCount.value++;
  audio.setLoop(cur.startMs, cur.endMs);
  audio.seekTo(cur.startMs);
  await audio.play();
  // 单遍播放：播完区间后暂停（简化：loop 由核心层保证至少播放一遍后由用户停止）
  setTimeout(() => {
    audio?.clearLoop();
    audio?.pause();
  }, cur.endMs - cur.startMs + 300);
}

/** 核对答案：逐词 diff（忽略大小写/标点/多余空格，core/training/dictation-diff） */
function check(): void {
  const cur = session.value?.current;
  if (!cur) return;
  tokens.value = diffWords(input.value, cur.textEn);
  accuracy.value = accuracyOf(tokens.value);
  checked.value = true;
  session.value?.submit({
    sentenceIndex: cur.index,
    score: accuracy.value,
    detail: { playCount: playCount.value }
  });
}

function rewrite(): void {
  checked.value = false;
  tokens.value = [];
  input.value = '';
  playCount.value = 0;
}

function next(): void {
  if (session.value?.done) {
    void finish();
  } else {
    input.value = '';
    checked.value = false;
    tokens.value = [];
    playCount.value = 0;
  }
}

async function finish(): Promise<void> {
  const s = session.value?.summarize();
  summary.value = s ?? null;
  const m = materialStore.currentMaterial;
  if (s && m) {
    await trainingStore.saveRecord({
      materialId: m.id,
      mode: 'dictation',
      scope: trainingStore.scope,
      score: s.averageScore,
      detail: { kind: 'dictation', averageAccuracy: s.averageScore, playCount: totalPlayCount.value }
    });
  }
}

function restart(): void {
  summary.value = null;
  totalPlayCount.value = 0;
  const m = materialStore.currentMaterial;
  if (m) trainingStore.startSession('dictation', materialStore.subtitleData?.sentences ?? [], trainingStore.scope);
}

function back(): void {
  uni.navigateBack();
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
}
.progress-info {
  font-size: 24rpx;
  color: #646a73;
  margin-bottom: 16rpx;
}
.play-card {
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 24rpx;
}
.play-btn {
  background: #3b6ef0;
  color: #fff;
  font-size: 30rpx;
  border-radius: 12rpx;
  padding: 0 48rpx;
}
.play-count {
  font-size: 22rpx;
  color: #8a9199;
}
.section-label {
  font-size: 26rpx;
  color: #646a73;
  display: block;
  margin-bottom: 12rpx;
}
.dictation-input {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  width: 100%;
  box-sizing: border-box;
  min-height: 160rpx;
  font-size: 30rpx;
}
.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
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
.diff-result {
  margin-top: 32rpx;
}
.tokens {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  line-height: 2;
}
.token {
  font-size: 30rpx;
  margin-right: 10rpx;
}
.token-correct {
  color: #1f2329;
}
.token-wrong {
  color: #d83931;
  text-decoration: line-through;
}
.token-missing {
  color: #2ea44f;
  text-decoration: underline;
}
.token-extra {
  color: #8a9199;
}
.accuracy {
  display: block;
  margin: 16rpx 0;
  font-size: 26rpx;
  color: #3b6ef0;
}
.result-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  z-index: 99;
}
.result-card {
  width: 100%;
  background: #fff;
  border-radius: 20rpx 20rpx 0 0;
  padding: 40rpx 32rpx calc(40rpx + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  align-items: center;
}
.summary-title {
  font-size: 36rpx;
  font-weight: 700;
}
.summary-sub {
  color: #646a73;
}
.weakest {
  width: 100%;
}
.weakest-item {
  display: block;
  font-size: 24rpx;
  color: #e8890c;
}
</style>
