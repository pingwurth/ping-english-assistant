/**
 * LRC 解析（架构文档 §2.4 lrc.ts）
 * - 支持一行多时间标签（合并同文本行，取最早时间）
 * - 跳过元数据行 [ti:]/[ar:]/[offset:] 等
 * - endMs 为空，由 index.ts 按下一句 startMs 推导
 */
import type { RawBlock } from './model';
import { extractLrcTimestamps, stripLrcTimestamps } from './timestamp';
import { stripBom } from './srt';

const META_TAG = /^\[(ti|ar|al|by|offset|re|ve|length):/i;

export function parseLrc(text: string): RawBlock[] {
  const lines = stripBom(text).split(/\r?\n/);
  const entries: { startMs: number; text: string }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || META_TAG.test(trimmed)) continue;
    const stamps = extractLrcTimestamps(trimmed);
    if (stamps.length === 0) continue;
    const textContent = stripLrcTimestamps(trimmed);
    if (!textContent) continue;
    for (const startMs of stamps) entries.push({ startMs, text: textContent });
  }

  // 按时间排序（同时间保留出现顺序），合并同一时间点的多行文本
  entries.sort((a, b) => a.startMs - b.startMs);
  const blocks: RawBlock[] = [];
  for (const e of entries) {
    const last = blocks[blocks.length - 1];
    if (last && last.startMs === e.startMs) {
      last.textLines.push(e.text);
    } else {
      blocks.push({
        order: blocks.length + 1,
        startMs: e.startMs,
        endMs: null,
        textLines: [e.text]
      });
    }
  }
  return blocks;
}
