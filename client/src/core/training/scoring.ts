/**
 * 评分加工（架构文档 §2.5 scoring.ts）
 * 统一 SOE 原始结果（小程序 SDK 直连 / 后端代理两种来源）为 ScoreReport，
 * 屏蔽厂商差异，UI 无感知（架构文档 §5.3）。
 */

export interface PhonemeScore {
  symbol: string;
  score: number;
}

export interface WordScore {
  text: string;
  score: number;
  phonemes: PhonemeScore[];
}

export interface ScoreReport {
  total: number;
  accuracy: number;
  fluency: number;
  integrity: number;
  words: WordScore[];
}

/** 词级低分阈值：<60 标红（架构文档 §2.5） */
export const LOW_SCORE_THRESHOLD = 60;

/** 腾讯 SOE 原始响应（后端代理已做一次字段映射时的宽容解析） */
export interface SoeRawResult {
  PronAccuracy?: number;
  PronFluency?: number;
  PronCompletion?: number;
  SuggestedScore?: number;
  Words?: {
    Word?: string;
    PronAccuracy?: number;
    Phonemes?: { Phone?: string; PronAccuracy?: number }[];
  }[];
  // 后端代理可能已映射为 camelCase
  total?: number;
  accuracy?: number;
  fluency?: number;
  integrity?: number;
  words?: { text: string; score: number; phonemes?: { symbol: string; score: number }[] }[];
}

/** 将任意来源的 SOE 原始结果归一为 ScoreReport */
export function normalizeSoeResult(raw: SoeRawResult): ScoreReport {
  if (typeof raw.total === 'number') {
    // 已是后端映射后的结构
    return {
      total: clampScore(raw.total),
      accuracy: clampScore(raw.accuracy ?? 0),
      fluency: clampScore(raw.fluency ?? 0),
      integrity: clampScore(raw.integrity ?? 0),
      words: (raw.words ?? []).map((w) => ({
        text: w.text,
        score: clampScore(w.score),
        phonemes: (w.phonemes ?? []).map((p) => ({ symbol: p.symbol, score: clampScore(p.score) }))
      }))
    };
  }
  // 腾讯 SOE 原始字段
  const words: WordScore[] = (raw.Words ?? []).map((w) => ({
    text: w.Word ?? '',
    score: clampScore(w.PronAccuracy ?? 0),
    phonemes: (w.Phonemes ?? []).map((p) => ({
      symbol: p.Phone ?? '',
      score: clampScore(p.PronAccuracy ?? 0)
    }))
  }));
  return {
    total: clampScore(raw.SuggestedScore ?? averageOf(words.map((w) => w.score))),
    accuracy: clampScore(raw.PronAccuracy ?? 0),
    fluency: clampScore(raw.PronFluency ?? 0),
    integrity: clampScore(raw.PronCompletion ?? 0),
    words
  };
}

/** 标记低分词（供 UI 标红） */
export function markLowScoreWords(report: ScoreReport): (WordScore & { low: boolean })[] {
  return report.words.map((w) => ({ ...w, low: w.score < LOW_SCORE_THRESHOLD }));
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function averageOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
