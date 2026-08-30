/**
 * 生词助记数据模型 —— LLM 生成的助记卡片结构
 *
 * 与 LLM 返回的 JSON 一一对应，前端直接渲染。
 */

/** 核心含义 */
export interface CoreMeaning {
  /** 最核心的英文释义（附中文翻译） */
  primary: string
  /** 1-2 个常见引申义 */
  extended: string[]
  /** 一句话描述词的"感觉"——语域、感情色彩、典型使用场景（英文） */
  semantic_range: string
}

/** 发音助记 */
export interface PhoneticMnemonic {
  /** 音节划分 + IPA */
  syllables: string
  /** 发音特征描述——重音、弱读、特殊音 */
  sound_shape: string
  /** 谐音或押韵词 */
  homophones_rhymes: string[]
}

/** 词根词缀 */
export interface WordRoots {
  /** 词根词缀拆解 */
  breakdown: string
  /** 同根词家族 */
  root_family: Array<{ word: string; meaning: string }>
  /** 一句话记忆技巧（中文优先） */
  hook: string
}

/** 例句 */
export interface MnemonicExample {
  /** 例句原文（目标词用 ** 加粗） */
  sentence: string
  /** 中文翻译 */
  translation: string
  /** 用法简注 */
  usage_note: string
}

/** 词组搭配 */
export interface Collocation {
  /** 搭配短语 */
  phrase: string
  /** 中文含义 */
  meaning: string
  /** 简短例句 */
  example: string
}

/** 助记卡片（即时生成） */
export interface MnemonicCard {
  core_meaning: CoreMeaning
  phonetic_mnemonic: PhoneticMnemonic
  word_roots: WordRoots
  examples: MnemonicExample[]
  collocations: Collocation[]
  /** 难度标签：easy / medium / hard */
  difficulty: 'easy' | 'medium' | 'hard'
}

/** 联想记忆 */
export interface Association {
  /** 联想类型 */
  type: 'image' | 'story' | 'sound_play' | 'absurd'
  /** 联想内容（中文为主） */
  content: string
  /** 为什么有效（一句话） */
  why_it_works: string
}

/** 听力辨别题 */
export interface ListeningSpot {
  /** 含目标词的句子 */
  sentence: string
  /** 难度 */
  difficulty: 'easy' | 'hard'
  /** 需要注意的语音特征 */
  phonetic_hint: string
}

/** 练习题（按需生成） */
export interface Exercises {
  /** IELTS 填空题 */
  ielts_blank: {
    sentence: string
    options: string[]
    answer: string
    explanation: string
  }
  /** 听力辨别题 */
  listening_spot: ListeningSpot[]
  /** 造句提示 */
  writing_prompt: string
}

/** 造句批改结果 */
export interface SentenceEvaluation {
  /** 使用是否正确 */
  is_correct: boolean
  /** 语法评分 1-5 */
  grammar_score: number
  /** 用词评分 1-5 */
  usage_score: number
  /** 反馈（中文为主） */
  feedback: string
  /** 改进版 */
  improved_version: string
  /** 更多例句 */
  example_sentence: string
}

/** 助记缓存（存入 IndexedDB） */
export interface MnemonicCache {
  /** 关联的 VocabEntry.id */
  id: string
  /** 即时卡片 */
  card: MnemonicCard
  /** 联想记忆（可选，按需生成） */
  association?: Association
  /** 练习题（可选，按需生成） */
  exercises?: Exercises
  /** 创建时间戳 */
  createdAt: number
}

/** 助记卡片 SSE 流式事件 */
export type MnemonicSseEvent =
  /** 某个顶层字段已解析完成 */
  | { event: 'field'; data: { field: keyof MnemonicCard; value: unknown } }
  /** 完整卡片已生成 */
  | { event: 'done'; data: { card: MnemonicCard; timing: { invokeMs: number; parseMs: number; contentLength: number } } }
  /** 错误 */
  | { event: 'error'; data: { error: string } }
