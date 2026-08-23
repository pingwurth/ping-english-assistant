/**
 * OpenAI LLM Provider（GPT-4o / 4o-mini，架构文档 §3.4）
 * 流式 chat completions；超时 120s，断流即 error。
 */
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { LlmProvider } from './llm-provider.js';

const TIMEOUT_MS = 120_000;

export class OpenAiLlmProvider implements LlmProvider {
  constructor(private config: AppConfig) {}

  async streamChat(prompt: string, onToken: (text: string) => void): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${this.config.OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.LLM_MODEL,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      if (!res.ok || !res.body) {
        throw Errors.upstream('openai', { status: res.status });
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let full = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
            };
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              full += content;
              onToken(content);
            }
          } catch {
            /* 忽略不完整行 */
          }
        }
      }
      return full;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw Errors.timeout('openai');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
