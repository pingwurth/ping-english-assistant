/**
 * 单句听写逐词对比（架构文档 §2.5 dictation-diff.ts）
 * normalize：小写、去标点、压缩空格；diffWords：逐词 LCS diff。
 * 输出 correct/wrong/missing/extra 四类标记供 UI 着色（原型设计 §4.6）。
 */

export type DiffTokenType = 'correct' | 'wrong' | 'missing' | 'extra';

export interface DiffToken {
  type: DiffTokenType;
  /** 原文中的词（missing 时为漏掉的词） */
  target?: string;
  /** 用户输入的词（extra 时为多写的词） */
  input?: string;
}

/** 归一化：小写、去标点（保留撇号）、压缩空格 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/**
 * 逐词 LCS diff：以原文为基准对齐用户输入。
 * - correct：位置匹配的词
 * - wrong：原文有、用户写成别的词
 * - missing：原文有、用户漏写
 * - extra：用户多写
 */
export function diffWords(input: string, target: string): DiffToken[] {
  const a = tokenize(target); // 基准（原文）
  const b = tokenize(input); // 用户输入
  const lcs = buildLcsTable(a, b);
  const tokens: DiffToken[] = [];

  let i = a.length;
  let j = b.length;
  const reversed: DiffToken[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      reversed.push({ type: 'correct', target: a[i - 1], input: b[j - 1] });
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      reversed.push({ type: 'missing', target: a[i - 1] });
      i--;
    } else {
      reversed.push({ type: 'extra', input: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    reversed.push({ type: 'missing', target: a[i - 1] });
    i--;
  }
  while (j > 0) {
    reversed.push({ type: 'extra', input: b[j - 1] });
    j--;
  }
  reversed.reverse();
  tokens.push(...reversed);

  // 相邻 missing + extra 配对为 wrong（错词），展示更直观
  return mergeWrong(tokens);
}

/** 本句正确率：correct 词数 / 原文词数（%） */
export function accuracyOf(tokens: DiffToken[]): number {
  const total = tokens.filter((t) => t.type === 'correct' || t.type === 'wrong' || t.type === 'missing').length;
  if (total === 0) return 100;
  const correct = tokens.filter((t) => t.type === 'correct').length;
  return Math.round((correct / total) * 100);
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function mergeWrong(tokens: DiffToken[]): DiffToken[] {
  const out: DiffToken[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const next = tokens[k + 1];
    if (t.type === 'missing' && next?.type === 'extra') {
      out.push({ type: 'wrong', target: t.target, input: next.input });
      k++;
    } else if (t.type === 'extra' && next?.type === 'missing') {
      out.push({ type: 'wrong', target: next.target, input: t.input });
      k++;
    } else {
      out.push(t);
    }
  }
  return out;
}
