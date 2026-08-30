/**
 * LLM 服务层入口 —— 统一导出
 */

export { createChatModel, normalizeProvider, isDashScopeNative, isOpenAICompatible, resolveProviderUrl } from './factory'
export { LlmError, toLlmError, throwIfAborted } from './errors'
export { translateTexts, detectDirection } from './chat-service'
export { generateMnemonicCard, generateMnemonicCardStream, generateAssociation, generateMnemonicExercises, evaluateSentence } from './mnemonic-service'
export { transcribe, getAsrProviderType } from './asr-service'
export { generateTts } from './tts-service'
export type {
  LlmProviderConfig,
  ChatModelConfig,
  AsrModelConfig,
  TtsModelConfig,
  AsrSegment,
  AsrResult,
  TtsResult,
  ChatMessage,
  TranslateConfig,
  LlmErrorCode,
} from './types'
