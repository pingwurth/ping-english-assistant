/**
 * 训练会话状态机（架构文档 §2.5 session.ts）
 * 题目队列、当前句推进、结果收集、小结汇总；与 UI 框架无关。
 */
import type { SubtitleSentence } from '../subtitle/model';

export type TrainingMode = 'puzzle' | 'dictation' | 'read-aloud' | 'shadowing' | 'recitation';

export interface SentenceResult {
  sentenceIndex: number;
  /** 本句得分（0-100，各模式归一化） */
  score: number;
  /** 播放/重试次数等模式内细节 */
  detail?: Record<string, number | string | boolean>;
}

export interface SessionSummary {
  totalCount: number;
  doneCount: number;
  averageScore: number;
  /** 最弱句 TOP3（可点回重练） */
  weakest: SentenceResult[];
}

export class TrainingSession {
  private queue: SubtitleSentence[];
  private cursor = 0;
  private results: SentenceResult[] = [];

  constructor(
    public readonly mode: TrainingMode,
    sentences: SubtitleSentence[]
  ) {
    this.queue = sentences;
  }

  get total(): number {
    return this.queue.length;
  }

  get position(): number {
    return this.cursor;
  }

  get done(): boolean {
    return this.cursor >= this.queue.length;
  }

  /** 当前句；全部完成时为 null */
  get current(): SubtitleSentence | null {
    return this.done ? null : this.queue[this.cursor];
  }

  /** 提交当前句结果并推进到下一句 */
  submit(result: SentenceResult): void {
    this.results.push(result);
    this.cursor++;
  }

  /** 重练当前句：不推进游标，丢弃该句上一次结果 */
  retry(): void {
    const cur = this.current;
    if (!cur) return;
    const idx = this.results.findIndex((r) => r.sentenceIndex === cur.index);
    if (idx >= 0) this.results.splice(idx, 1);
  }

  get collectedResults(): readonly SentenceResult[] {
    return this.results;
  }

  /** 小结汇总：平均得分、最弱句 TOP3 */
  summarize(): SessionSummary {
    const scores = this.results.map((r) => r.score);
    const averageScore =
      scores.length === 0 ? 0 : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const weakest = [...this.results].sort((a, b) => a.score - b.score).slice(0, 3);
    return {
      totalCount: this.queue.length,
      doneCount: this.results.length,
      averageScore,
      weakest
    };
  }
}

export function createSession(mode: TrainingMode, sentences: SubtitleSentence[]): TrainingSession {
  return new TrainingSession(mode, sentences);
}
