/**
 * 前端核心业务模型（架构文档 §4.1）
 * 字幕模型见 core/subtitle/model.ts。
 */

/** 学习材料（元数据，媒体与字幕文件本体存端内文件系统） */
export interface Material {
  id: string;
  name: string;
  mediaType: 'video' | 'audio';
  /** 端内本地引用：H5 为 IndexedDB 中的 Blob key，小程序为本地文件路径 */
  mediaRef: string;
  mediaFileName: string;
  mediaSizeBytes: number;
  subtitle: {
    ref: string;
    format: 'srt' | 'lrc';
    isBilingual: boolean;
    sentenceCount: number;
  } | null;
  durationMs: number;
  createdAt: number;
  lastOpenedAt: number;
}

/** 学习进度（每材料一条） */
export interface LearningProgress {
  materialId: string;
  lastPositionMs: number;
  /** 精听/训练中播放过的句子，驱动材料库进度条 */
  playedSentenceIndexes: number[];
  updatedAt: number;
}

/** 句子收藏 */
export interface Favorite {
  materialId: string;
  sentenceIndex: number;
  createdAt: number;
}

export type TrainingMode = 'puzzle' | 'dictation' | 'read-aloud' | 'shadowing' | 'recitation';

export type TrainingScope = { type: 'all' } | { type: 'favorites' };

export interface PuzzleDetail {
  kind: 'puzzle';
  correctCount: number;
  totalCount: number;
}

export interface DictationDetail {
  kind: 'dictation';
  averageAccuracy: number;
  playCount: number;
}

export interface ReadAloudDetail {
  kind: 'read-aloud';
  averageScore: number;
}

export interface ReportDetail {
  kind: 'report';
  total: number;
  completeness?: number;
  accuracy?: number;
  fluency?: number;
}

/** 训练记录（五模式联合类型） */
export interface TrainingRecord {
  id: string;
  materialId: string;
  mode: TrainingMode;
  scope: TrainingScope;
  /** 各模式归一化综合分（0-100） */
  score: number;
  detail: PuzzleDetail | DictationDetail | ReadAloudDetail | ReportDetail;
  createdAt: number;
}

/** TTS 生成记录（端内缓存 24h，支持重复导入，见原型设计 §4.12） */
export interface TtsTask {
  taskId: string;
  text: string;
  voice: string;
  speed: number;
  /** 音频本端引用（H5 Blob key / 小程序临时文件路径） */
  audioRef: string;
  /** SRT 文本（withSubtitle 时） */
  srt: string | null;
  durationMs: number;
  sentenceCount: number;
  createdAt: number;
}
