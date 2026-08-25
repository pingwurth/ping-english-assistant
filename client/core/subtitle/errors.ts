/**
 * 字幕解析错误 —— 带行号，供导入页就地提示（docs/系统架构设计.md §2.4 容错策略）。
 */

export class SubtitleParseError extends Error {
  /** 出错位置（1 基行号；无法定位时为 0） */
  readonly line: number

  constructor(message: string, line = 0) {
    super(message)
    this.name = 'SubtitleParseError'
    this.line = line
  }
}
