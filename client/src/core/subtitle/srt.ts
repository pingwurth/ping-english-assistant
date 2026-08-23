/**
 * SRT 解析（架构文档 §2.4 srt.ts）
 * 容错策略参考 srt-parser-2：时间戳分隔符 ,/. 兼容、块间空行不敏感、
 * 序号缺失按出现顺序补号、UTF-8 BOM 去除。
 */
import type { RawBlock } from './model';
import { SubtitleParseError } from './model';
import { parseSrtTimeline } from './timestamp';

export function parseSrt(text: string): RawBlock[] {
  const lines = stripBom(text).split(/\r?\n/);
  const blocks: RawBlock[] = [];
  let cur: RawBlock | null = null;
  let autoOrder = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i].trim();

    if (line === '') {
      if (cur && cur.textLines.length > 0) {
        blocks.push(cur);
        cur = null;
      }
      continue;
    }

    const timeline = parseSrtTimeline(line, lineNo);
    if (timeline) {
      // 新块开始：上一个未闭合块先落库
      if (cur && cur.textLines.length > 0) blocks.push(cur);
      cur = { order: ++autoOrder, ...timeline, textLines: [] };
      continue;
    }

    if (!cur) {
      // 序号行（纯数字）且尚无时间轴：跳过并记序
      if (/^\d+$/.test(line)) continue;
      // 序号缺失时，文本出现在时间轴之前属于异常
      throw new SubtitleParseError(`时间戳格式无法识别: "${line}"`, lineNo);
    }

    if (cur.textLines.length === 0 && /^\d+$/.test(line)) {
      // 时间轴后的序号行（容错：序号写在时间轴之后）
      continue;
    }
    cur.textLines.push(line);
  }

  if (cur && cur.textLines.length > 0) blocks.push(cur);
  return blocks;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
