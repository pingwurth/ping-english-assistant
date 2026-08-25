/**
 * Mock 训练报告（契约③ POST /api/v1/reports/shadowing · 契约④ /reports/recitation）
 * —— 真源：docs/系统架构设计.md §3.3 契约③④
 *
 * AsyncGenerator<SseEvent> 按架构约定的 SSE 事件序产出：
 *   status(stage: comparing) → status(analyzing) → status(summarizing)
 *   → token × N（模板化中文 Markdown 报告，按模式区分影子跟读/背诵）
 *   → result（{ total, completeness, accuracy, fluency } 结构化评分）
 *   → done
 * 用 await 延迟模拟流式节奏（默认总时长约 3-5s）；AbortSignal 中止时 yield error 事件
 * （code 'ABORTED'）后终止；其他异常 yield error 事件（统一错误格式）后终止。
 */

import type { SseEvent, TrainingReportRequest } from '../../types/api'
import { abortableDelay, throwIfAborted, toApiError } from '../contracts'

export type ReportMode = 'shadowing' | 'recitation'

export interface MockReportOptions {
  /** 各事件间延迟的缩放系数（默认 1；测试可传 0 加速） */
  paceScale?: number
  /** 可配置失败率 0-1（默认 0）：命中时在 token 阶段 yield error 事件终止 */
  failRate?: number
  /** 测试钩子：覆盖延迟实现 */
  delayImpl?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 测试钩子：覆盖随机数源（失败率判定用） */
  randomImpl?: () => number
}

/** FNV-1a 32bit（与 mock/soe.ts 同款，保持确定性风格） */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 模板化报告（Markdown，中文）：按模式区分影子跟读 / 背诵 */
function buildReport(mode: ReportMode, payload: TrainingReportRequest): string {
  const { materialTitle, transcript, sentences } = payload
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0
  const isShadowing = mode === 'shadowing'
  const modeLabel = isShadowing ? '影子跟读' : '背诵'
  const focusLine = isShadowing
    ? '- **节奏与同步**：语速与原声基本同步，个别长句存在 0.5s 左右的滞后；\n- **语音还原**：重音与连读还原较好，弱读处理仍有提升空间。'
    : '- **记忆完整**：核心句均被覆盖，个别连接词出现遗漏；\n- **自主输出**：表达流畅自然，未出现长时间停顿或重复。'
  return [
    `# ${modeLabel}训练报告`,
    '',
    `**材料**：${materialTitle || '未命名材料'} · 共 ${sentences.length} 句`,
    '',
    '## 总体表现',
    `本次${modeLabel}共转写识别 ${wordCount} 词，整体完成度良好。${
      isShadowing ? '跟读过程中语音与原文对齐度较高，主要失分点集中在语速同步与弱读细节。' : '背诵输出与原文语义基本一致，主要失分点集中在个别词句的完整复现。'
    }`,
    '',
    '## 分项点评',
    focusLine,
    '',
    '## 改进建议',
    `1. ${isShadowing ? '先以 0.8× 倍速逐句跟读，稳定后再恢复原速；' : '先做首词提示式回忆，再尝试整句完整输出；'}`,
    '2. 对得分低于 60 的词逐词跟读三遍，重点纠正元音发音；',
    '3. 完成下一轮训练后，对比本次报告观察流利度变化。',
    '',
  ].join('\n')
}

/** 确定性结构化评分（hash(transcript#materialTitle#mode) 派生，契约③④ result 事件） */
function buildResult(mode: ReportMode, payload: TrainingReportRequest): {
  total: number
  completeness: number
  accuracy: number
  fluency: number
} {
  const seed = fnv1a(`${payload.transcript}#${payload.materialTitle}#${mode}`)
  const total = 72 + (seed % 22) // [72, 93]
  return {
    total,
    completeness: clampScore(total + ((seed >>> 8) % 13) - 6),
    accuracy: clampScore(total + ((seed >>> 16) % 13) - 6),
    fluency: clampScore(total + ((seed >>> 24) % 13) - 6),
  }
}

async function* run(
  mode: ReportMode,
  payload: TrainingReportRequest,
  options: MockReportOptions,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const pace = options.paceScale ?? 1
  const delay = options.delayImpl ?? abortableDelay
  const random = options.randomImpl ?? Math.random

  yield { event: 'status', data: { stage: 'comparing' } }
  await delay(500 * pace, signal)

  yield { event: 'status', data: { stage: 'analyzing' } }
  await delay(400 * pace, signal)

  // 可配置失败：在分析阶段注入 error 事件（供前端错误 UI 测试）
  const failRate = Math.max(0, Math.min(1, options.failRate ?? 0))
  if (failRate > 0 && random() < failRate) {
    yield {
      event: 'error',
      data: { code: 'REPORT_UPSTREAM_ERROR', message: '报告生成服务暂时不可用（mock 注入失败）' },
    }
    return
  }

  yield { event: 'status', data: { stage: 'summarizing' } }
  await delay(300 * pace, signal)

  // 分片 token：按空白切块（保留 Markdown 标记），总 token 节奏约 2-3.5s
  const report = buildReport(mode, payload)
  const chunks = report.split(/(\s+)/).filter((c) => c.length > 0)
  for (const chunk of chunks) {
    await delay(24 * pace, signal)
    yield { event: 'token', data: { text: chunk } }
  }

  yield { event: 'result', data: buildResult(mode, payload) }
  await delay(200 * pace, signal)
  yield { event: 'done', data: {} }
}

/** 包装生成器：统一把中止/异常转换为 error 事件后终止（SSE 断流即 error，架构 §3.4） */
async function* guarded(
  mode: ReportMode,
  payload: TrainingReportRequest,
  options: MockReportOptions,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  try {
    throwIfAborted(signal)
    yield* run(mode, payload, options, signal)
  } catch (err) {
    const apiErr = toApiError(err)
    yield { event: 'error', data: { code: apiErr.code, message: apiErr.message, detail: apiErr.detail } }
  }
}

/** 契约③ 影子跟读报告（SSE） */
export class MockShadowingReportService {
  constructor(private readonly options: MockReportOptions = {}) {}

  shadowing(payload: TrainingReportRequest, signal?: AbortSignal): AsyncGenerator<SseEvent> {
    return guarded('shadowing', payload, this.options, signal)
  }
}

/** 契约④ 背诵报告（SSE） */
export class MockRecitationReportService {
  constructor(private readonly options: MockReportOptions = {}) {}

  recitation(payload: TrainingReportRequest, signal?: AbortSignal): AsyncGenerator<SseEvent> {
    return guarded('recitation', payload, this.options, signal)
  }
}
