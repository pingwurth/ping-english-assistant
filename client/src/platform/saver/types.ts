/**
 * FileSaver 文件保存适配层接口（架构文档 §2.8 · v1.1 新增）
 * TTS 产物"保存到用户设备"三端机制差异大，抽象为统一接口。
 */

export interface SaveResult {
  /** 展示给用户的存放位置描述 */
  locationText: string;
  /** 端内引用（H5 为 Blob key，小程序为 savedFilePath/临时文件路径），供"一键导入"直接取用 */
  localRef: string;
}

export interface FileSaver {
  /** 保存音频文件到用户设备；小程序触发系统目录选择 */
  saveAudio(data: Blob | string /* 小程序临时文件路径 */, fileName: string): Promise<SaveResult>;
  /** 保存文本文件（如 SRT 字幕） */
  saveText(text: string, fileName: string): Promise<SaveResult>;
}
