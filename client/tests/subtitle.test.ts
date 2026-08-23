/**
 * 字幕解析器单测（架构文档 §2.4 · ADR-2）
 * 覆盖：SRT/LRC 解析、双语拆分、容错（BOM/分隔符/序号缺失）、LRC 结束时间推导。
 */
import { describe, expect, it } from 'vitest';
import { parseSubtitle, SubtitleParseError } from '../src/core/subtitle';
import { parseSrtTimestamp } from '../src/core/subtitle/timestamp';
import { splitBilingual, splitWords, isCJK } from '../src/core/subtitle/bilingual';

const SRT_BILINGUAL = `1
00:00:02,610 --> 00:00:05,230
You should answer the questions as you listen.
你应该边听边回答问题。

2
00:00:05,500 --> 00:00:09,100
For each question, choose the best answer.
对于每个问题，选择最佳答案。

3
00:00:09,300 --> 00:00:12,000
You will hear each conversation only once.
你将只听到每段对话一次。
`;

describe('SRT 解析', () => {
  it('解析双语 SRT：句数/时间轴/双语拆分正确', () => {
    const data = parseSubtitle(SRT_BILINGUAL, 'srt');
    expect(data.format).toBe('srt');
    expect(data.sentences).toHaveLength(3);
    expect(data.isBilingual).toBe(true);
    expect(data.sentences[0]).toMatchObject({
      index: 0,
      startMs: 2610,
      endMs: 5230,
      textEn: 'You should answer the questions as you listen.',
      textZh: '你应该边听边回答问题。'
    });
    expect(data.totalDurationMs).toBe(12000);
  });

  it('words 切分保留撇号、剥离标点', () => {
    const data = parseSubtitle(SRT_BILINGUAL, 'srt');
    expect(data.sentences[0].words).toEqual(['You', 'should', 'answer', 'the', 'questions', 'as', 'you', 'listen']);
  });

  it('容错：BOM + 逗号/句号分隔符 + 序号缺失补号', () => {
    const messy = '﻿00:00:01.000 --> 00:00:02.500\nHello world.\n\n00:00:03,000 --> 00:00:04,000\nSecond line.\n';
    const data = parseSubtitle(messy, 'srt');
    expect(data.sentences).toHaveLength(2);
    expect(data.sentences[0].startMs).toBe(1000);
    expect(data.sentences[1].textEn).toBe('Second line.');
  });

  it('解析失败抛出带行号的 SubtitleParseError', () => {
    expect(() => parseSubtitle('not a subtitle\ncontent here', 'srt')).toThrow(SubtitleParseError);
    try {
      parseSubtitle('not a subtitle\ncontent here', 'srt');
    } catch (e) {
      expect((e as SubtitleParseError).line).toBe(1);
    }
  });

  it('时间戳解析：1-3 位毫秒兼容', () => {
    expect(parseSrtTimestamp('00:00:02,610')).toBe(2610);
    expect(parseSrtTimestamp('00:00:02.5')).toBe(2500);
    expect(parseSrtTimestamp('01:02:03,04')).toBe(3723040);
  });
});

describe('LRC 解析', () => {
  it('解析 LRC：endMs 由下一句 startMs 推导', () => {
    const lrc = '[ti:Test]\n[00:02.50]Hello there\n[00:05.00]General Kenobi\n[00:08.00]End line\n';
    const data = parseSubtitle(lrc, 'lrc');
    expect(data.format).toBe('lrc');
    expect(data.sentences).toHaveLength(3);
    expect(data.sentences[0]).toMatchObject({ startMs: 2500, endMs: 5000, textEn: 'Hello there' });
    expect(data.sentences[2].startMs).toBe(8000);
    expect(data.sentences[2].endMs).toBeGreaterThan(8000); // 末句补齐
  });

  it('跳过元数据行；空内容抛错', () => {
    expect(() => parseSubtitle('[ti:Only meta]\n[ar:artist]\n', 'lrc')).toThrow(SubtitleParseError);
  });

  it('格式嗅探：按内容识别 LRC', () => {
    const data = parseSubtitle('[00:01.00]hello\n[00:03.00]world\n');
    expect(data.format).toBe('lrc');
  });
});

describe('双语拆分', () => {
  it('两行上英下中', () => {
    expect(splitBilingual(['Hello world.', '你好世界。'])).toEqual({
      textEn: 'Hello world.',
      textZh: '你好世界。'
    });
  });

  it('两行上中下英反序', () => {
    expect(splitBilingual(['你好世界。', 'Hello world.'])).toEqual({
      textEn: 'Hello world.',
      textZh: '你好世界。'
    });
  });

  it('单行英文', () => {
    expect(splitBilingual(['Hello.'])).toEqual({ textEn: 'Hello.', textZh: null });
  });

  it('多行：连续同类行合并', () => {
    const r = splitBilingual(['Line one.', 'Line two.', '第一行', '第二行']);
    expect(r.textEn).toBe('Line one. Line two.');
    expect(r.textZh).toBe('第一行 第二行');
  });

  it('isCJK 判定', () => {
    expect(isCJK('你好')).toBe(true);
    expect(isCJK('Hello')).toBe(false);
  });

  it("splitWords 保留 don't 撇号", () => {
    expect(splitWords("I don't know.")).toEqual(['I', "don't", 'know']);
  });
});

describe('双语判定阈值', () => {
  it('中文句占比 >30% → isBilingual', () => {
    // 3 句中 1 句有中文 = 33% > 30%
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello.
你好。

2
00:00:02,000 --> 00:00:03,000
World.

3
00:00:03,000 --> 00:00:04,000
Again.
`;
    expect(parseSubtitle(srt, 'srt').isBilingual).toBe(true);
  });

  it('占比 ≤30% → 非双语', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello.
你好。

2
00:00:02,000 --> 00:00:03,000
World.

3
00:00:03,000 --> 00:00:04,000
Again.

4
00:00:04,000 --> 00:00:05,000
More.
`;
    expect(parseSubtitle(srt, 'srt').isBilingual).toBe(false);
  });
});
