/**
 * 九宫格词块（架构文档 §2.5 puzzle.ts）
 * 拆词 + 洗牌；词数 >15 时按标点并块，保证单屏可操作。
 */
import type { SubtitleSentence } from '../subtitle/model';

export interface Tile {
  id: number;
  text: string;
}

/** 生成九宫格词块（已打乱顺序） */
export function buildTiles(sentence: SubtitleSentence, rand: () => number = Math.random): Tile[] {
  const chunks = chunkSentence(sentence);
  const tiles = chunks.map((text, id) => ({ id, text }));
  return shuffle(tiles, rand);
}

/** 按词拆分；词数 >15 时按标点/语义并块 */
export function chunkSentence(sentence: SubtitleSentence): string[] {
  const words = sentence.words;
  if (words.length <= 15) return words;
  // 按标点短语块拆分：把词重新按标点分组
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const w of sentence.textEn.split(/\s+/)) {
    cur.push(w);
    if (/[,;:.!?]$/.test(w) || cur.length >= 4) {
      chunks.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length > 0) chunks.push(cur.join(' '));
  return chunks;
}

/** Fisher-Yates 洗牌（注入随机源便于测试） */
export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PuzzleCheckResult {
  correct: boolean;
  /** 首个错误位下标；全对时为 -1 */
  firstErrorIndex: number;
}

/** 校验拼句结果：picked 为按语序点选的词块文本序列 */
export function checkAnswer(picked: string[], sentence: SubtitleSentence): PuzzleCheckResult {
  const expected = chunkSentence(sentence);
  for (let i = 0; i < Math.max(picked.length, expected.length); i++) {
    if (normalizeToken(picked[i] ?? '') !== normalizeToken(expected[i] ?? '')) {
      return { correct: false, firstErrorIndex: i };
    }
  }
  return { correct: true, firstErrorIndex: -1 };
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 提示：返回下一个应选词块的文本（每句最多 3 次，扣 2 分） */
export function nextHint(picked: string[], sentence: SubtitleSentence): string | null {
  const expected = chunkSentence(sentence);
  return expected[picked.length] ?? null;
}
