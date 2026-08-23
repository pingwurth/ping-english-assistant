/**
 * SSE 流式客户端（架构文档 §3.3）
 * 事件序列：status（阶段进度）→ token（流式文本）→ result（结构化 JSON）→ done / error。
 * H5 用 fetch ReadableStream；小程序 wx.request 不支持流式，降级为轮询完整响应（后续迭代可换 TCP）。
 */

export interface SseEvent {
  event: 'status' | 'token' | 'result' | 'done' | 'error';
  data: unknown;
}

export interface SseHandlers {
  onStatus?: (stage: string) => void;
  onToken?: (text: string) => void;
  onResult?: (result: Record<string, unknown>) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

/** 发起 SSE 请求（POST JSON），按事件类型分发 */
export async function postSse(url: string, body: unknown, handlers: SseHandlers): Promise<void> {
  // #ifdef H5
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body)
    });
    if (!res.ok || !res.body) throw new Error(`请求失败: HTTP ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        dispatchSseChunk(chunk, handlers);
      }
    }
    handlers.onDone?.();
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
  }
  // #endif
  // #ifdef MP-WEIXIN
  // 小程序 wx.request 不支持 SSE 流式：一次性请求，服务端在非流式 Accept 下返回完整 JSON
  uni.request({
    url,
    method: 'POST',
    data: body as never,
    header: { 'Content-Type': 'application/json', Accept: 'application/json' },
    success: (res) => {
      const data = res.data as { markdown?: string; result?: Record<string, unknown> };
      if (data.markdown) handlers.onToken?.(data.markdown);
      if (data.result) handlers.onResult?.(data.result);
      handlers.onDone?.();
    },
    fail: (err) => handlers.onError?.(new Error(err.errMsg || '请求失败'))
  });
  // #endif
}

function dispatchSseChunk(chunk: string, handlers: SseHandlers): void {
  let event = '';
  let dataText = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataText += line.slice(5).trim();
  }
  if (!event) return;
  let data: unknown = dataText;
  try {
    data = JSON.parse(dataText);
  } catch {
    /* 纯文本 token */
  }
  switch (event) {
    case 'status':
      handlers.onStatus?.(String((data as { stage?: string }).stage ?? data));
      break;
    case 'token':
      handlers.onToken?.(String((data as { text?: string }).text ?? data));
      break;
    case 'result':
      handlers.onResult?.(data as Record<string, unknown>);
      break;
    case 'done':
      handlers.onDone?.();
      break;
    case 'error':
      handlers.onError?.(new Error(String((data as { message?: string }).message ?? '流式生成失败')));
      break;
  }
}
