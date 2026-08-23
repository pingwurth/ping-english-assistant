/**
 * 字幕解析统一入口（架构文档 §2.4 index.ts）
 * parseSubtitle(text, format?) → SubtitleData；format 缺省时按内容嗅探。
 */
import type { RawBlock, SubtitleData, SubtitleSentence } from './model';
import { SubtitleParseError } from './model';
import { parseSrt } from './srt';
import { parseLrc } from './lrc';
import { splitBilingual, splitWords } from './bilingual';

export type SubtitleFormat = 'srt' | 'lrc';

/** 按内容嗅探字幕格式：LRC 以 [mm:ss] 标签为特征，否则按 SRT 处理 */
export function detectFormat(text: string, fileName?: string): SubtitleFormat {
  if (fileName) {
    const ext = fileName.toLowerCase().split('.').pop();
    if (ext === 'srt' || ext === 'lrc') return ext;
  }
  return /\[\d{1,2}:\d{2}[.:]\d{1,3}\]/.test(text) ? 'lrc' : 'srt';
}

export function parseSubtitle(
  text: string,
  format?: SubtitleFormat,
  fileName?: string
): SubtitleData {
  const fmt = format ?? detectFormat(text, fileName);
  const blocks = fmt === 'srt' ? parseSrt(text) : parseLrc(text);
  if (blocks.length === 0) {
    throw new SubtitleParseError('未解析到任何字幕内容，请检查文件格式');
  }
  return buildSubtitleData(blocks, fmt);
}

/** 由原始块构建 SubtitleData：双语拆分、LRC 结束时间推导、words 切分 */
export function buildSubtitleData(blocks: RawBlock[], format: SubtitleFormat): SubtitleData {
  const sorted = [...blocks].sort((a, b) => a.startMs - b.startMs);
  const sentences: SubtitleSentence[] = sorted.map((block, i) => {
    const { textEn, textZh } = splitBilingual(block.textLines);
    // LRC 无结束时间：endMs = 下一句 startMs；末句暂置 null，末尾统一补齐
    const endMs =
      block.endMs ?? (i + 1 < sorted.length ? sorted[i + 1].startMs : null);
    return {
      index: i,
      startMs: block.startMs,
      endMs: endMs ?? block.startMs,
      textEn,
      textZh,
      words: splitWords(textEn)
    };
  });

  // 末句 endMs 补齐：至少持续 2s
  const last = sentences[sentences.length - 1];
  if (last.endMs <= last.startMs) last.endMs = last.startMs + 2000;

  // 防御：句间时间轴倒挂时，endMs 不越过下一句 startMs
  for (let i = 0; i < sentences.length - 1; i++) {
    if (sentences[i].endMs > sentences[i + 1].startMs) {
      sentences[i].endMs = sentences[i + 1].startMs;
    }
  }

  const zhCount = sentences.filter((s) => s.textZh != null).length;
  const isBilingual = zhCount / sentences.length > 0.3;
  return {
    format,
    isBilingual,
    sentences,
    totalDurationMs: last.endMs
  };
}

export * from './model';
export { parseSrt } from './srt';
export { parseLrc } from './lrc';
export { isCJK, splitBilingual, splitWords } from './bilingual';
export { formatMs, toSrtTimestamp } from './timestamp';
