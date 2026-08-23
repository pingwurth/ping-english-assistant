/**
 * Anthropic Claude LLM Provider（备选，架构文档 §3.4）
 * Messages API SSE 流式；超时 120s。
 */
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { LlmProvider } from './llm-provider.js';

const TIMEOUT_MS = 120_000;

export class AnthropicLlmProvider implements LlmProvider {
  constructor(private config: AppConfig) {}

  async streamChat(prompt: string, onToken: (text: string) => void): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.config.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.ANTHROPIC_MODEL,
          max_tokens: 4096,
          stream: true,
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      });
      if (!res.ok || !res.body) {
        throw Errors.upstream('anthropic', { status: res.status });
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
          try {
            const json = JSON.parse(line.slice(5).trim()) as {
              type?: string;
              delta?: { type?: string; text?: string };
            };
            if (json.type === 'content_block_delta' && json.delta?.text) {
              full += json.delta.text;
              onToken(json.delta.text);
            }
          } catch {
            /* 忽略不完整行 */
          }
        }
      }
      return full;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw Errors.timeout('anthropic');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
