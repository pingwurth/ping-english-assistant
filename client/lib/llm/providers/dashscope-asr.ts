/**
 * DashScope ASR Provider —— 阿里云原生 multimodal-generation API
 *
 * 使用 qwen-audio 系列模型的原生 API，返回文本和词级时间戳。
 * 请求脚手架（鉴权/超时/取消/错误归一/data-URL 构造）见 asr-audio.ts 共享实现。
 */

import type { AsrModelConfig, AsrResult, AsrSegment } from '../types'
import { LlmError } from '../errors'
import { resolveProviderUrl } from '../factory'
import { assertAsrApiKey, groupWordsToSegments, postAsrJson, toAudioDataUrl, type WordTimestamp } from '../asr-audio'

interface DashScopeWord {
  begin_time: number
  end_time: number
  text: string
  punctuation?: string
}


/**
 * DashScope ASR 转写
 *
 * 使用原生 multimodal-generation API，可返回词级时间戳。
 */
export async function transcribeDashScope(
  audioFile: File,
  config: AsrModelConfig,
  signal?: AbortSignal,
): Promise<AsrResult> {
  // 配置解析只有一处真源（评审 #8）：路由层已保证 model 非空，这里不再拿
  // 别家默认模型名二次兜底 —— 兜底会把 qwen 模型发给用户自建 baseUrl
  if (!config.model) {
    throw new LlmError('MODEL_NOT_CONFIGURED', '请先在设置页配置转写（ASR）模型')
  }
  const model = config.model
  const url = resolveProviderUrl(config.baseUrl, config.endpoint, 'dashscope', 'asr')
  // key 预检先于音频 base64 编码（c002）：缺 key 快速失败，不白读整段音频
  assertAsrApiKey(config.apiKey)

  // DashScope native API 使用 input.messages with input_audio
  const body = {
    model,
    input: {
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
    },
    parameters: {
      format: inferAudioFormat(audioFile.name),
    },
  }

  console.log(`[ASR DashScope] POST ${url} (model=${model}, audio=${(audioFile.size / 1024).toFixed(0)}KB)`)

  const result = (await postAsrJson(url, config.apiKey, body, 'DashScope', signal)) as unknown
  return parseDashScopeAsrResponse(result)
}

/** DashScope 响应里 sentence 对象的已知形态（原生顶层 / OpenAI 兼容嵌套） */
interface DashScopeSentence {
  text?: string
  begin_time?: number
  end_time?: number
  words?: DashScopeWord[]
}

interface DashScopeAsrResponse {
  sentence?: DashScopeSentence
  output?: { text?: string; output?: { sentence?: DashScopeSentence } }
}

/**
 * 解析 DashScope ASR 响应 → AsrResult（纯函数，形态回归测试的测定点）。
 *
 * 已知三种文本形态共用一条链：`sentence.text`（原生顶层）→ `output.text`
 * （兼容层）→ `output.output.sentence.text`（嵌套）。词级时间戳此前只读顶层
 * `result.sentence.words` —— 嵌套形态下原生词级时间轴被静默丢弃（c010）；
 * 现在与文本同链：任一 sentence 形态带 words 即采用。
 */
export function parseDashScopeAsrResponse(result: unknown): AsrResult {
  const r = (result ?? {}) as DashScopeAsrResponse
  const sentences: DashScopeSentence[] = [
    r.sentence,
    r.output?.output?.sentence,
  ].filter((s): s is DashScopeSentence => !!s)

  const text: string =
    r.sentence?.text ||
    r.output?.text ||
    r.output?.output?.sentence?.text ||
    ''

  if (!text.trim()) {
    console.warn('DashScope ASR returned empty text. Response:', JSON.stringify(result).slice(0, 500))
    return { text: '', segments: [] }
  }

  // 词级时间戳：取第一个带非空 words 的 sentence 形态（通常仅一处存在）
  const wordSource = sentences.find((s) => Array.isArray(s.words) && s.words.length > 0)
  const apiWords: DashScopeWord[] = wordSource?.words || []

  if (apiWords.length > 0) {
    const words: WordTimestamp[] = apiWords.map(w => ({
      word: w.punctuation ? `${w.text}${w.punctuation}` : w.text,
      // NaN 兜底：上游缺 begin_time/end_time 时 `undefined/1000 = NaN` 会污染时间轴，回退为 0
      start: Number.isFinite(w.begin_time) ? w.begin_time / 1000 : 0,
      end: Number.isFinite(w.end_time) ? w.end_time / 1000 : 0,
    }))
    const segments = groupWordsToSegments(words)
    console.log(`[ASR DashScope] ${words.length} words → ${segments.length} segments`)
    return { text: text.trim(), segments }
  }

  // 回退：使用句子级时间戳
  const timed = sentences.find((s) => s.begin_time != null && s.end_time != null)
  if (timed) {
    const segments: AsrSegment[] = [{
      startMs: timed.begin_time!,
      endMs: timed.end_time!,
      text: text.trim(),
    }]
    return { text: text.trim(), segments }
  }

  // 最后回退：无时间戳，返回纯文本
  console.log('[ASR DashScope] No timestamps available, returning text only')
  return { text: text.trim(), segments: [] }
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 按文件扩展名推断音频格式（DashScope 参数用） */
function inferAudioFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    mp3: 'mp3', wav: 'wav', m4a: 'm4a', ogg: 'ogg', flac: 'flac',
    webm: 'webm', aac: 'aac', amr: 'amr', avi: 'avi', flv: 'flv',
    mkv: 'mkv', mov: 'mov', mp4: 'mp4', mpeg: 'mpeg', opus: 'opus',
    wma: 'wma', wmv: 'wmv',
  }
  return map[ext || ''] || 'mp3'
}
