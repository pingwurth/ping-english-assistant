/**
 * 跟读评分客户端（架构文档 §5.3）
 * 小程序端 SOE SDK 直连；Web/H5 端走后端代理。
 * 两路原始字段不同，统一在 core/training/scoring.ts 归一为 ScoreReport。
 */
import { uploadMultipart } from './api-client';
import { normalizeSoeResult, type ScoreReport, type SoeRawResult } from '@/core/training/scoring';

export interface SoeEvaluateInput {
  /** H5 Blob / 小程序临时文件路径 */
  audio: Blob | string;
  refText: string;
  fileName?: string;
}

export async function evaluatePronunciation(input: SoeEvaluateInput): Promise<ScoreReport> {
  // #ifdef MP-WEIXIN
  // TODO(M4)：接入腾讯 SOE 小程序 SDK 直连（微信生态内鉴权，不暴露 SecretKey）。
  // SDK 引入后替换此处的后端代理调用；返回结果同样经 normalizeSoeResult 归一。
  // #endif
  const raw = await uploadMultipart<SoeRawResult>('/api/v1/soe/evaluate', {
    file: input.audio,
    fileFieldName: 'audio',
    fileName: input.fileName ?? 'recording.wav',
    fields: { refText: input.refText, evalMode: 'sentence' }
  });
  return normalizeSoeResult(raw);
}
