/**
 * SSE 写出器（架构文档 §3.3）
 * 事件序列：status → token → result → done / error。
 */
import type { FastifyReply } from 'fastify';

export class SseWriter {
  constructor(private reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
  }

  status(stage: string): void {
    this.write('status', { stage });
  }

  token(text: string): void {
    this.write('token', { text });
  }

  result(data: Record<string, unknown>): void {
    this.write('result', data);
  }

  done(): void {
    this.write('done', {});
    this.reply.raw.end();
  }

  error(message: string): void {
    this.write('error', { message });
    this.reply.raw.end();
  }

  private write(event: string, data: unknown): void {
    this.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/** 判断客户端是否接受 SSE（小程序 wx.request 不支持流式，降级返回完整 JSON） */
export function acceptsSse(reply: FastifyReply): boolean {
  const accept = String(reply.request.headers.accept ?? '');
  return accept.includes('text/event-stream');
}
