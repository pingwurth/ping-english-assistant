/**
 * 腾讯云智聆 SOE 客户端（架构文档 §3.4）
 * 服务端签名（SecretId/Key 存 env）；音频 base64 内嵌请求体；ServerType=0（英文）；
 * 结果字段映射为内部 ScoreReport 模型，屏蔽厂商差异。
 *
 * 签名算法：TC3-HMAC-SHA256（腾讯云 API 3.0 标准）。
 */
import { createHash, createHmac } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { Errors } from '../../lib/errors.js';

const HOST = 'soe.ap-guangzhou.tencentcloudapi.com';
const SERVICE = 'soe';
const ACTION = 'InitOralProcess';
const VERSION = '2018-07-24';
const TIMEOUT_MS = 15_000;

export interface SoeEvalInput {
  audio: Buffer;
  refText: string;
  evalMode: 'sentence' | 'word';
}

export interface SoeScoreReport {
  total: number;
  accuracy: number;
  fluency: number;
  integrity: number;
  words: { text: string; score: number; phonemes: { symbol: string; score: number }[] }[];
}

interface SoeRawWord {
  Word?: string;
  PronAccuracy?: number;
  Phonemes?: { Phone?: string; PronAccuracy?: number }[];
}

export class SoeClient {
  constructor(private config: AppConfig) {}

  async evaluate(input: SoeEvalInput): Promise<SoeScoreReport> {
    if (!this.config.TENCENT_SOE_SECRET_ID || !this.config.TENCENT_SOE_SECRET_KEY) {
      throw Errors.internal('腾讯 SOE 密钥未配置（TENCENT_SOE_SECRET_ID/KEY）');
    }
    const payload = JSON.stringify({
      SessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      RefText: input.refText,
      WorkMode: 0,
      EvalMode: input.evalMode === 'sentence' ? 1 : 0,
      ScoreCoeff: 3.5,
      ServerType: 0, // 英文
      IsAsync: 0,
      VoiceFileType: 1, // wav
      VoiceEncodeType: 1,
      UserVoiceData: input.audio.toString('base64')
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://${HOST}/`, {
        method: 'POST',
        headers: this.buildSignedHeaders(payload),
        body: payload,
        signal: controller.signal
      });
      if (!res.ok) {
        throw Errors.upstream('tencent-soe', { status: res.status });
      }
      const data = (await res.json()) as {
        Response?: {
          Error?: { Code: string; Message: string };
          PronAccuracy?: number;
          PronFluency?: number;
          PronCompletion?: number;
          SuggestedScore?: number;
          Words?: SoeRawWord[];
        };
      };
      const r = data.Response;
      if (r?.Error) {
        throw Errors.upstream('tencent-soe', r.Error);
      }
      return this.mapToReport(r ?? {});
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw Errors.timeout('tencent-soe');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** SOE 原始字段 → 内部 ScoreReport（架构文档 §3.4） */
  private mapToReport(r: {
    PronAccuracy?: number;
    PronFluency?: number;
    PronCompletion?: number;
    SuggestedScore?: number;
    Words?: SoeRawWord[];
  }): SoeScoreReport {
    return {
      total: clampScore(r.SuggestedScore ?? 0),
      accuracy: clampScore(r.PronAccuracy ?? 0),
      fluency: clampScore(r.PronFluency ?? 0),
      integrity: clampScore(r.PronCompletion ?? 0),
      words: (r.Words ?? []).map((w) => ({
        text: w.Word ?? '',
        score: clampScore(w.PronAccuracy ?? 0),
        phonemes: (w.Phonemes ?? []).map((p) => ({
          symbol: p.Phone ?? '',
          score: clampScore(p.PronAccuracy ?? 0)
        }))
      }))
    };
  }

  /** TC3-HMAC-SHA256 签名 */
  private buildSignedHeaders(payload: string): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const hashedPayload = sha256Hex(payload);
    const canonicalRequest = `POST\n/\n\ncontent-type:application/json\nhost:${HOST}\n\ncontent-type;host\n${hashedPayload}`;
    const credentialScope = `${date}/${SERVICE}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
    const secretDate = hmac(`TC3${this.config.TENCENT_SOE_SECRET_KEY}`, date);
    const secretService = hmac(secretDate, SERVICE);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
    const authorization = `TC3-HMAC-SHA256 Credential=${this.config.TENCENT_SOE_SECRET_ID}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;
    return {
      'Content-Type': 'application/json',
      Host: HOST,
      Authorization: authorization,
      'X-TC-Action': ACTION,
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(timestamp)
    };
  }
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
