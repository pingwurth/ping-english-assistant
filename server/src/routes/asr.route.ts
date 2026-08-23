/**
 * ASR 转写路由（架构文档 §3.3-①）
 * POST /api/v1/asr/transcribe — 录音转写（影子跟读/背诵第一步；Web 端听写识别）
 */
import type { FastifyInstance } from 'fastify';
import { Errors } from '../lib/errors.js';
import { cleanup, saveUpload } from '../lib/tempfiles.js';
import type { AppConfig } from '../config/env.js';
import { WhisperProvider } from '../services/asr/whisper.provider.js';
import { XunfeiProvider } from '../services/asr/xunfei.provider.js';
import type { AsrProvider } from '../services/asr/asr-provider.js';

export function createAsrProvider(config: AppConfig): AsrProvider {
  return config.ASR_PROVIDER === 'xunfei'
    ? new XunfeiProvider(config)
    : new WhisperProvider(config);
}

export async function asrRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const provider = createAsrProvider(config);

  app.post('/api/v1/asr/transcribe', async (req) => {
    const mp = await req.file();
    if (!mp) throw Errors.badRequest('缺少音频文件（字段名 audio）');
    const fields = mp.fields as Record<string, { value?: string } | undefined>;
    const lang = fields.lang?.value ?? 'en';

    // 录音处理完即删（finally 清理，架构文档 §3.5 录音隐私）
    const { path } = await saveUpload(mp.file, 'wav');
    try {
      return await provider.transcribe(path, lang);
    } finally {
      await cleanup(path);
    }
  });
}
