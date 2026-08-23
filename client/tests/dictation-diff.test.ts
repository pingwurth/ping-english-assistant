/**
 * 听写 diff 单测（架构文档 §2.5 dictation-diff.ts）
 */
import { describe, expect, it } from 'vitest';
import { accuracyOf, diffWords, normalize } from '../src/core/training/dictation-diff';

describe('normalize', () => {
  it('小写、去标点（保留撇号）、压缩空格', () => {
    expect(normalize("  You   Should, Answer!  Don't ")).toBe("you should answer don't");
  });
});

describe('diffWords', () => {
  it('完全正确：全部 correct', () => {
    const tokens = diffWords('you should answer', 'You should answer.');
    expect(tokens.every((t) => t.type === 'correct')).toBe(true);
    expect(accuracyOf(tokens)).toBe(100);
  });

  it('错词：missing + extra 配对为 wrong', () => {
    // "lis" vs "listen"
    const tokens = diffWords('questions as you lis', 'questions as you listen.');
    const wrong = tokens.find((t) => t.type === 'wrong');
    expect(wrong).toMatchObject({ target: 'listen', input: 'lis' });
  });

  it('漏词标 missing', () => {
    const tokens = diffWords('you answer', 'you should answer');
    expect(tokens.some((t) => t.type === 'missing' && t.target === 'should')).toBe(true);
  });

  it('多词标 extra', () => {
    const tokens = diffWords('you should really answer', 'you should answer');
    expect(tokens.some((t) => t.type === 'extra' && t.input === 'really')).toBe(true);
  });

  it('accuracyOf：correct / 原文词数', () => {
    const tokens = diffWords('you should', 'you should answer'); // 2/3 correct
    expect(accuracyOf(tokens)).toBe(67);
  });

  it('空输入：全 missing，正确率 0', () => {
    const tokens = diffWords('', 'you should answer');
    expect(accuracyOf(tokens)).toBe(0);
  });
});
