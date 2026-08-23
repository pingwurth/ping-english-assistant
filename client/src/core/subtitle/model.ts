/**
 * 字幕数据模型（架构文档 §2.4，与选型报告 §2.4 一致）
 * 一句一行是全局核心对象：播放控制、字幕展示、训练模式都围绕它展开。
 */

export interface SubtitleSentence {
  /** 句序号（从 0 开始） */
  index: number;
  startMs: number;
  endMs: number;
  /** 英文原文（无英文时为空串） */
  textEn: string;
  /** 中文译文（无中文时为 null） */
  textZh: string | null;
  /** 英文按空格切分并剥离首尾标点的词列表（训练用，保留撇号如 don't） */
  words: string[];
}

export interface SubtitleData {
  format: 'srt' | 'lrc';
  /** 含 textZh 的句子占比 > 30% 时为 true（架构文档 §2.4 规则 4） */
  isBilingual: boolean;
  sentences: SubtitleSentence[];
  /** 字幕覆盖的总时长（末句 endMs） */
  totalDurationMs: number;
}

/** 字幕解析失败：携带行号供导入页就地提示（架构文档 §2.4 容错策略） */
export class SubtitleParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(line != null ? `${message}（第 ${line} 行）` : message);
    this.name = 'SubtitleParseError';
  }
}

/** 解析中间产物：一个原始字幕块（尚未做双语拆分） */
export interface RawBlock {
  /** 原块序号（SRT 序号；LRC 按出现顺序） */
  order: number;
  startMs: number;
  /** LRC 无结束时间，由后续句子推导 */
  endMs: number | null;
  /** 去除序号行/时间轴行后的文本行 */
  textLines: string[];
}
