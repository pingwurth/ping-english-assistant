/**
 * 时间戳解析（架构文档 §2.4 timestamp.ts）
 * 兼容 SRT "00:00:02,610"（,/'.' 分隔符均兼容）与 LRC "[02:33.50]"。
 */
import { SubtitleParseError } from './model';

const SRT_TS = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const LRC_TS = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** 解析单个 SRT 时间戳为毫秒 */
export function parseSrtTimestamp(ts: string, line?: number): number {
  const m = SRT_TS.exec(ts.trim());
  if (!m) throw new SubtitleParseError(`时间戳格式无法识别: "${ts.trim()}"`, line);
  const [, hh, mm, ss, ms] = m;
  return toMs(+hh, +mm, +ss, ms);
}

/** 解析 SRT 时间轴行 "00:00:02,610 --> 00:00:04,920" */
export function parseSrtTimeline(lineText: string, line?: number): { startMs: number; endMs: number } | null {
  const parts = lineText.split('-->');
  if (parts.length !== 2) return null;
  return {
    startMs: parseSrtTimestamp(parts[0], line),
    endMs: parseSrtTimestamp(parts[1], line)
  };
}

/** 提取一行 LRC 文本中的所有时间戳（支持一行多标签 "[00:12.30][00:34.50]歌词"） */
export function extractLrcTimestamps(lineText: string): number[] {
  const result: number[] = [];
  LRC_TS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LRC_TS.exec(lineText)) !== null) {
    result.push(toMs(0, +m[1], +m[2], m[3] ?? '0'));
  }
  return result;
}

/** 剥离一行文本中的全部 LRC 时间戳标签，得到纯文本 */
export function stripLrcTimestamps(lineText: string): string {
  return lineText.replace(LRC_TS, '').trim();
}

function toMs(hh: number, mm: number, ss: number, msText: string): number {
  // 毫秒位兼容 1~3 位（"5"=500ms，"50"=500ms，"500"=500ms）
  let ms = +msText;
  if (msText.length === 1) ms *= 100;
  else if (msText.length === 2) ms *= 10;
  return ((hh * 60 + mm) * 60 + ss) * 1000 + ms;
}

/** 毫秒 → "mm:ss" 展示格式 */
export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 毫秒 → SRT 时间戳 "00:00:02,610"（TTS 生成字幕用，架构文档 §5.5） */
export function toSrtTimestamp(ms: number): string {
  const hh = Math.floor(ms / 3600000);
  const mm = Math.floor((ms % 3600000) / 60000);
  const ss = Math.floor((ms % 60000) / 1000);
  const msec = Math.floor(ms % 1000);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)},${String(msec).padStart(3, '0')}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
