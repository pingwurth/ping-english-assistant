<template>
  <view class="page">
    <view class="progress-info">
      <text>进度 {{ sessionPos }}/{{ sessionTotal }}</text>
      <view class="track"><view class="fill" :style="{ width: `${(sessionPos / sessionTotal) * 100}%` }" /></view>
    </view>

    <button class="replay-btn" @click="replay">🔊 重听原句 {{ playerStore.rate }}x</button>

    <!-- 拼句区 -->
    <text class="section-label">拼句区（按语序点选）:</text>
    <view class="answer-area">
      <view
        v-for="(tile, i) in picked"
        :key="tile.id"
        class="tile tile-picked"
        :class="{ error: result && !result.correct && result.firstErrorIndex === i }"
        @click="unpick(i)"
      >
        {{ tile.text }}
      </view>
      <text v-if="picked.length === 0" class="placeholder">点击下方候选词拼出句子</text>
    </view>

    <!-- 候选词块 -->
    <text class="section-label">候选词块:</text>
    <view class="tiles-grid">
      <view
        v-for="tile in tiles"
        :key="tile.id"
        class="tile"
        :class="{ used: isUsed(tile.id) }"
        @click="pick(tile)"
      >
        {{ tile.text }}
      </view>
    </view>

    <view class="actions">
      <button class="act-btn" @click="clearPicked">🗑 清空</button>
      <button class="act-btn" :disabled="hintLeft <= 0" @click="hint">💡 提示({{ hintLeft }})</button>
      <button class="act-btn primary" :disabled="picked.length === 0" @click="submit">✓ 提交</button>
    </view>

    <!-- 结果浮层 -->
    <view v-if="result" class="result-mask">
      <view class="result-card">
        <text class="result-text" :class="{ ok: result.correct }">
          {{ result.correct ? '✅ 完全正确！+10 分' : `❌ 第 ${result.firstErrorIndex + 1} 词有误` }}
        </text>
        <view class="result-actions">
          <button class="act-btn" @click="retry">重试本句</button>
          <button class="act-btn primary" @click="nextSentence">下一句 →</button>
        </view>
      </view>
    </view>

    <!-- 完成小结浮层 -->
    <view v-if="summary" class="result-mask">
      <view class="result-card">
        <text class="summary-title">本轮完成</text>
        <text class="result-text">平均得分 {{ summary.averageScore }}</text>
        <text class="summary-sub">完成 {{ summary.doneCount }}/{{ summary.totalCount }} 句</text>
        <view class="result-actions">
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
import { buildTiles, checkAnswer, nextHint, type Tile } from '@/core/training/puzzle';
import type { SessionSummary } from '@/core/training/session';
import { createPlayer } from '@/platform/player';
import { getStorage } from '@/platform/storage';
import type { PlayerController } from '@/core/player/types';

const materialStore = useMaterialStore();
const playerStore = usePlayerStore();
const trainingStore = useTrainingStore();

const session = computed(() => trainingStore.session);
const sessionPos = computed(() => (session.value?.position ?? 0) + (session.value?.done ? 0 : 1));
const sessionTotal = computed(() => session.value?.total ?? 1);

const tiles = ref<Tile[]>([]);
const picked = ref<Tile[]>([]);
const hintLeft = ref(3);
const submitLeft = ref(2);
const result = ref<{ correct: boolean; firstErrorIndex: number } | null>(null);
const summary = ref<SessionSummary | null>(null);
const score = ref(0);

let audio: PlayerController | null = null;

onMounted(async () => {
  if (!session.value || !materialStore.currentMaterial) return;
  // 训练页用独立音频播放器播放当前句区间（不影响精听页状态）
  audio = createPlayer('audio');
  const src = await getStorage().resolveFileSrc(materialStore.currentMaterial.mediaRef);
  await audio.load({ type: 'audio', src });
  setupSentence();
});

function setupSentence(): void {
  const cur = session.value?.current;
  if (!cur) return;
  tiles.value = buildTiles(cur);
  picked.value = [];
  hintLeft.value = 3;
  submitLeft.value = 2;
  result.value = null;
}

function isUsed(id: number): boolean {
  return picked.value.some((t) => t.id === id);
}

function pick(tile: Tile): void {
  if (isUsed(tile.id) || result.value?.correct) return;
  picked.value.push(tile);
}

function unpick(i: number): void {
  if (result.value?.correct) return;
  picked.value.splice(i, 1);
}

function clearPicked(): void {
  picked.value = [];
}

/** 💡 提示：揭示下一个正确词（扣 2 分），每句最多 3 次 */
function hint(): void {
  const cur = session.value?.current;
  if (!cur || hintLeft.value <= 0) return;
  const next = nextHint(picked.value.map((t) => t.text), cur);
  if (next == null) return;
  const tile = tiles.value.find((t) => !isUsed(t.id) && t.text === next);
  if (tile) {
    picked.value.push(tile);
    hintLeft.value--;
    score.value = Math.max(0, score.value - 2);
  }
}

function submit(): void {
  const cur = session.value?.current;
  if (!cur) return;
  const r = checkAnswer(picked.value.map((t) => t.text), cur);
  result.value = r;
  if (r.correct) {
    score.value += 10;
    session.value?.submit({ sentenceIndex: cur.index, score: 100, detail: { hints: 3 - hintLeft.value } });
  } else {
    submitLeft.value--;
    if (submitLeft.value <= 0) {
      // 每句最多 2 次提交，用完按 0 分推进
      session.value?.submit({ sentenceIndex: cur.index, score: 0 });
    }
  }
}

function retry(): void {
  result.value = null;
  picked.value = [];
  if (submitLeft.value <= 0) submitLeft.value = 1;
}

function nextSentence(): void {
  result.value = null;
  if (session.value?.done) {
    finish();
  } else {
    setupSentence();
  }
}

async function finish(): Promise<void> {
  const s = session.value?.summarize();
  summary.value = s ?? null;
  const m = materialStore.currentMaterial;
  if (s && m) {
    await trainingStore.saveRecord({
      materialId: m.id,
      mode: 'puzzle',
      scope: trainingStore.scope,
      score: s.averageScore,
      detail: { kind: 'puzzle', correctCount: s.doneCount, totalCount: s.totalCount }
    });
  }
}

function restart(): void {
  const m = materialStore.currentMaterial;
  if (!m) return;
  trainingStore.startSession('puzzle', materialStore.subtitleData?.sentences ?? [], trainingStore.scope);
  summary.value = null;
  score.value = 0;
  setupSentence();
}

function back(): void {
  uni.navigateBack();
}

async function replay(): Promise<void> {
  const cur = session.value?.current;
  if (!cur || !audio) return;
  audio.setLoop(cur.startMs, cur.endMs);
  audio.seekTo(cur.startMs);
  await audio.play();
}
</script>

<style lang="scss" scoped>
.page {
  padding: 24rpx;
  max-width: 1280rpx;
  margin: 0 auto;
}
.progress-info {
  margin-bottom: 24rpx;
  font-size: 24rpx;
  color: #646a73;
}
.track {
  height: 10rpx;
  background: #f0f1f5;
  border-radius: 5rpx;
  margin-top: 8rpx;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #3b6ef0;
}
.replay-btn {
  background: #fff;
  border-radius: 12rpx;
  font-size: 28rpx;
  margin-bottom: 24rpx;
}
.section-label {
  font-size: 26rpx;
  color: #646a73;
  display: block;
  margin: 16rpx 0 12rpx;
}
.answer-area {
  min-height: 120rpx;
  background: #fff;
  border-radius: 12rpx;
  padding: 16rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  align-content: flex-start;
}
.placeholder {
  color: #c0c4cc;
  font-size: 24rpx;
}
.tiles-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12rpx;
}
.tile {
  background: #fff;
  border: 2rpx solid #e5e6eb;
  border-radius: 12rpx;
  padding: 20rpx 12rpx;
  text-align: center;
  font-size: 28rpx;
  &.used {
    opacity: 0.3;
  }
  &.tile-picked {
    border-color: #3b6ef0;
  }
  &.error {
    border-color: #d83931;
    color: #d83931;
  }
}
.actions {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;
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
.result-text {
  font-size: 32rpx;
  &.ok {
    color: #2ea44f;
  }
}
.summary-title {
  font-size: 36rpx;
  font-weight: 700;
}
.summary-sub {
  color: #646a73;
}
.result-actions {
  display: flex;
  gap: 16rpx;
  width: 100%;
}
</style>
