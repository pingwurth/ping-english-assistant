/**
 * LLM Provider 接口（架构文档 §3.2）
 * streamChat 流式输出；Prompt 模板 + 变量插值；
 * 要求模型末尾输出 ---RESULT--- 后的 JSON 评分块（架构文档 §3.4）。
 */

export interface LlmStreamHandlers {
  onToken: (text: string) => void;
}

export interface LlmProvider {
  /** 流式对话；返回完整文本（服务端解析拆分为 token/result 两类 SSE 事件） */
  streamChat(prompt: string, onToken: (text: string) => void): Promise<string>;
}

export interface ReportScores {
  total?: number;
  completeness?: number;
  accuracy?: number;
  fluency?: number;
}

/** 从完整输出中拆分 Markdown 正文与 ---RESULT--- 后的 JSON 评分块 */
export function splitReportOutput(full: string): { markdown: string; scores: ReportScores | null } {
  const marker = '---RESULT---';
  const idx = full.lastIndexOf(marker);
  if (idx < 0) return { markdown: full, scores: null };
  const markdown = full.slice(0, idx).trim();
  const jsonText = full.slice(idx + marker.length).trim();
  try {
    const scores = JSON.parse(jsonText) as ReportScores;
    return { markdown, scores };
  } catch {
    return { markdown: full, scores: null };
  }
}
