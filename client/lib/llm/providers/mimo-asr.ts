/**
 * MiMo ASR Provider —— OpenAI-compatible multimodal 语音识别
 *
 * 使用 input_audio content type 发送 base64 音频数据。
 * 请求脚手架（鉴权/超时/取消/错误归一/data-URL 构造）见 asr-audio.ts 共享实现。
 */

import type { AsrModelConfig, AsrResult } from '../types'
import { resolveProviderUrl } from '../factory'
import { getDefaultModel } from '@/lib/service-endpoints'
import { postAsrJson, toAudioDataUrl } from '../asr-audio'

/**
 * MiMo ASR 转写
 *
 * 发送 OpenAI-compatible multimodal 请求，返回转写文本。
 * 时间戳需通过 WhisperX 对齐或比例分配获取（本函数不处理）。
 */
export async function transcribeMimo(
  audioFile: File,
  config: AsrModelConfig,
  signal?: AbortSignal,
): Promise<AsrResult> {
  const model = config.model || getDefaultModel('mimo', 'asr')
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'mimo', 'asr')

  const body = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: { data: await toAudioDataUrl(audioFile) },
          },
        ],
      },
    ],
    extra_body: {
      asr_options: { language: 'auto' },
    },
  }

  console.log('[ASR MiMo] URL:', url)
  console.log('[ASR MiMo] Model:', model, '| Audio:', (audioFile.size / 1024).toFixed(0), 'KB')

  const result = (await postAsrJson(url, config.apiKey, body, 'MiMo', signal)) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text: string = result.choices?.[0]?.message?.content || ''

  // MiMo ASR 不返回时间戳，返回纯文本，由上层处理时间戳
  if (!text.trim()) return { text: '', segments: [] }
  return { text: text.trim(), segments: [] }
}
