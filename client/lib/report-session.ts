/**
 * 报告会话载荷缓存（模块级单例）—— P7/P8 训练页 → P9 分析报告页的跨页数据桥梁。
 *
 * 背景：react-router 客户端跳转不携带复杂载荷（Blob/转写文本），P7 影子跟读与
 * P8 全文背诵在完成录音 + ASR 转写后，通过 setReportPayload() 写入会话载荷，
 * 随即 <Navigate replace> 跳转 /training/report；P9 报告页挂载时调用
 * takeReportPayload() 读取（取后即清空，避免刷新/二次进入消费过期载荷）。
 *
 * 消费方契约（批次 E 的 P9 报告页）：
 *  - takeReportPayload() 返回 null 表示"无进行中的报告会话"（如用户直接访问
 *    /training/report），P9 应降级展示（当前为静态演示数字）；
 *  - mode 决定调用契约③（shadowing）或契约④（recitation）报告服务；
 *  - transcript + sentences 即契约③④ TrainingReportRequest 的字段口径
 *    （transcript 为契约① ASR 转写结果；sentences 为原文句引用，textZh 可为空串）；
 *  - recordingBlob 为本次录音 WAV（16kHz mono），供"[▶ 回听我的录音]"使用，
 *    未录到音时为 undefined；startedAt 为训练开始时间戳（ms）。
 */

/** P9 报告页消费的会话载荷（影子跟读 / 全文背诵共用结构） */
export interface ReportSessionPayload {
  /** 训练模式：决定 P9 使用契约③还是契约④报告服务 */
  mode: 'shadowing' | 'recitation'
  /** 材料 id（返回精听/再次练习的路由参数） */
  materialId: string
  /** 材料标题（报告页页头展示） */
  materialTitle: string
  /** 契约① ASR 转写文本（前端可编辑修正后再请求报告） */
  transcript: string
  /** 原文句引用（口径对齐 types/api.ts ReportSentenceRef；textZh 无中文字幕时为 ''） */
  sentences: { index: number; textEn: string; textZh: string }[]
  /** 本次录音 WAV Blob（16kHz mono）；无录音时缺省 */
  recordingBlob?: Blob
  /** 训练开始时间戳（ms） */
  startedAt: number
}

/** 模块级缓存（客户端路由跳转间存活；刷新页面即丢失，P9 需处理 null 降级） */
let payload: ReportSessionPayload | null = null

/** P7/P8 完成转写后写入载荷，随即跳转 /training/report */
export function setReportPayload(next: ReportSessionPayload): void {
  payload = next
}

/** P9 挂载时读取载荷；取后即清空（一次性消费） */
export function takeReportPayload(): ReportSessionPayload | null {
  const taken = payload
  payload = null
  return taken
}
