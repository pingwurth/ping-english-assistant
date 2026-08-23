/**
 * 讯飞 ASR Provider（降级备选，架构文档 §5.6）
 * TODO(M4)：接入讯飞语音听写 WebSocket API（实时流式）。
 * 当前为占位实现：ASR_PROVIDER=xunfei 且未完成接入时明确报错，
 * 避免静默降级导致前端误判。
 */
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';
import type { AsrProvider, TranscriptResult } from './asr-provider.js';

export class XunfeiProvider implements AsrProvider {
  constructor(private config: AppConfig) {}

  async transcribe(_audioFilePath: string, _lang: string): Promise<TranscriptResult> {
    // 讯飞听写为 WebSocket 流式协议（appid + apiKey 鉴权签名），
    // 需在 M4 语音评测里程碑完成接入；配置键已在 config/env.ts 校验。
    void this.config;
    throw Errors.internal('讯飞 ASR 尚未接入（M4 里程碑），请切换 ASR_PROVIDER=whisper');
  }
}
