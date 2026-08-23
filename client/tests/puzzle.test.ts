/**
 * 九宫格词块单测（架构文档 §2.5 puzzle.ts）
 */
import { describe, expect, it } from 'vitest';
import { buildTiles, checkAnswer, chunkSentence, nextHint } from '../src/core/training/puzzle';
import type { SubtitleSentence } from '../src/core/subtitle';

function makeSentence(textEn: string): SubtitleSentence {
  return {
    index: 0,
    startMs: 0,
    endMs: 3000,
    textEn,
    textZh: null,
    words: textEn.split(/\s+/).map((w) => w.replace(/[.,!?]$/, ''))
  };
}

describe('九宫格词块', () => {
  it('词数 ≤9：单词拆分，洗牌后集合不变', () => {
    const s = makeSentence('You should answer the questions.');
    const tiles = buildTiles(s, () => 0.42);
    expect(tiles.map((t) => t.text).sort()).toEqual(['You', 'answer', 'questions', 'should', 'the'].sort());
  });

  it('词数 >15：按标点并块', () => {
    const s = makeSentence(
      'When you are listening to a long conversation, you should pay attention to the main idea, and try to remember the key details of it.'
    );
    const chunks = chunkSentence(s);
    expect(chunks.length).toBeLessThan(15);
    expect(chunks.join(' ').replace(/[.,]/g, '')).toContain('main idea');
  });

  it('checkAnswer：全对', () => {
    const s = makeSentence('You should answer.');
    const expected = chunkSentence(s);
    expect(checkAnswer(expected, s).correct).toBe(true);
  });

  it('checkAnswer：标出首个错误位', () => {
    const s = makeSentence('You should answer.');
    const r = checkAnswer(['You', 'answer', 'should'], s);
    expect(r.correct).toBe(false);
    expect(r.firstErrorIndex).toBe(1);
  });

  it('nextHint 返回下一个正确词', () => {
    const s = makeSentence('You should answer.');
    expect(nextHint([], s)).toBe('You');
    expect(nextHint(['You'], s)).toBe('should');
    expect(nextHint(['You', 'should', 'answer'], s)).toBeNull();
  });
});
