/**
 * 训练 Store（架构文档 §2.6）
 * 训练模式统一会话；P9 报告流式数据。
 */
import { defineStore } from 'pinia';
import { markRaw, ref } from 'vue';
import type { TrainingRecord } from '@/types';
import type { TrainingScope } from '@/types';
import type { TrainingMode } from '@/core/training/session';
import { createSession, type TrainingSession } from '@/core/training/session';
import type { SubtitleSentence } from '@/core/subtitle';
import { getStorage, StorageKeys } from '@/platform/storage';
import { genId } from '@/utils/id';

export interface ReportStream {
  stage: 'idle' | 'uploading' | 'transcribing' | 'analyzing' | 'done' | 'error';
  markdown: string;
  result: {
    total?: number;
    completeness?: number;
    accuracy?: number;
    fluency?: number;
  } | null;
}

export const useTrainingStore = defineStore('training', () => {
  const session = ref<TrainingSession | null>(null);
  const scope = ref<TrainingScope>({ type: 'all' });
  const records = ref<TrainingRecord[]>([]);
  const reportStream = ref<ReportStream>({ stage: 'idle', markdown: '', result: null });

  function startSession(mode: TrainingMode, sentences: SubtitleSentence[], s: TrainingScope): void {
    scope.value = s;
    session.value = markRaw(createSession(mode, sentences));
    reportStream.value = { stage: 'idle', markdown: '', result: null };
  }

  function endSession(): void {
    session.value = null;
  }

  /** 保存训练记录（各模式完成后调用） */
  async function saveRecord(record: Omit<TrainingRecord, 'id' | 'createdAt'>): Promise<void> {
    records.value.unshift({ ...record, id: genId(), createdAt: Date.now() });
    await getStorage().setMeta(StorageKeys.trainingRecords, records.value);
  }

  async function restoreRecords(): Promise<void> {
    records.value =
      (await getStorage().getMeta<TrainingRecord[]>(StorageKeys.trainingRecords)) ?? [];
  }

  /** 各模式最近一次成绩（训练中心模式卡片展示） */
  function lastScoreOf(materialId: string, mode: TrainingMode): number | null {
    const rec = records.value.find((r) => r.materialId === materialId && r.mode === mode);
    return rec?.score ?? null;
  }

  function resetReportStream(): void {
    reportStream.value = { stage: 'idle', markdown: '', result: null };
  }

  return {
    session,
    scope,
    records,
    reportStream,
    startSession,
    endSession,
    saveRecord,
    restoreRecords,
    lastScoreOf,
    resetReportStream
  };
});
