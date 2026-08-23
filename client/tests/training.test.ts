/**
 * 训练会话状态机 + SOE 评分归一单测（架构文档 §2.5）
 */
import { describe, expect, it } from 'vitest';
import { createSession } from '../src/core/training/session';
import { normalizeSoeResult, markLowScoreWords } from '../src/core/training/scoring';
import type { SubtitleSentence } from '../src/core/subtitle';

function sentences(n: number): SubtitleSentence[] {
  return Array.from({ length: n }, (_, i) => ({
    index: i,
    startMs: i * 3000,
    endMs: (i + 1) * 3000,
    textEn: `Sentence ${i + 1}.`,
    textZh: null,
    words: ['Sentence', String(i + 1)]
  }));
}

describe('TrainingSession', () => {
  it('推进与完成', () => {
    const s = createSession('puzzle', sentences(3));
    expect(s.done).toBe(false);
    s.submit({ sentenceIndex: 0, score: 100 });
    s.submit({ sentenceIndex: 1, score: 60 });
    s.submit({ sentenceIndex: 2, score: 80 });
    expect(s.done).toBe(true);
    const sum = s.summarize();
    expect(sum.averageScore).toBe(80);
    expect(sum.weakest[0].score).toBe(60);
  });

  it('retry 丢弃上一次结果不推进游标', () => {
    const s = createSession('dictation', sentences(2));
    s.submit({ sentenceIndex: 0, score: 100 });
    expect(s.position).toBe(1);
    s.retry(); // 当前是第 2 句，无结果可丢弃
    expect(s.position).toBe(1);
  });
});

describe('SOE 评分归一', () => {
  it('腾讯原始字段 → ScoreReport', () => {
    const report = normalizeSoeResult({
      PronAccuracy: 85.4,
      PronFluency: 78.2,
      PronCompletion: 90,
      SuggestedScore: 82.6,
      Words: [
        { Word: 'answer', PronAccuracy: 55, Phonemes: [{ Phone: 'æ', PronAccuracy: 40 }] },
        { Word: 'listen', PronAccuracy: 92, Phonemes: [] }
      ]
    });
    expect(report.total).toBe(83);
    expect(report.accuracy).toBe(85);
    expect(report.words[0]).toMatchObject({ text: 'answer', score: 55 });
    expect(report.words[0].phonemes[0]).toEqual({ symbol: 'æ', score: 40 });
  });

  it('已映射结构直接透传并 clamp', () => {
    const report = normalizeSoeResult({
      total: 101,
      accuracy: -5,
      fluency: 80,
      integrity: 90,
      words: [{ text: 'ok', score: 88 }]
    });
    expect(report.total).toBe(100);
    expect(report.accuracy).toBe(0);
  });

  it('低分词标记（<60 标红）', () => {
    const report = normalizeSoeResult({
      total: 80,
      accuracy: 80,
      fluency: 80,
      integrity: 80,
      words: [
        { text: 'bad', score: 55 },
        { text: 'good', score: 90 }
      ]
    });
    const marked = markLowScoreWords(report);
    expect(marked[0].low).toBe(true);
    expect(marked[1].low).toBe(false);
  });
});
