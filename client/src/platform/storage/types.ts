/**
 * 本地持久化适配层接口（架构文档 §4.2）
 * 元数据 KV + 媒体文件存储；H5 用 IndexedDB，小程序用 Storage + USER_DATA_PATH。
 */

export interface StorageAdapter {
  /** 元数据 KV */
  getMeta<T>(key: string): Promise<T | null>;
  setMeta(key: string, value: unknown): Promise<void>;
  removeMeta(key: string): Promise<void>;

  /**
   * 保存媒体/字幕文件本体，返回端内引用 ref
   * @param data H5 为 Blob；小程序为临时文件路径（string）
   */
  saveFile(data: Blob | string, fileName: string): Promise<string>;
  /** 读取文件为可播放 src（H5 返回 ObjectURL；小程序返回本地文件路径） */
  resolveFileSrc(ref: string): Promise<string>;
  /** 读取文本文件内容（字幕解析用） */
  readTextFile(ref: string): Promise<string>;
  removeFile(ref: string): Promise<void>;
}

/** 存储 key 前缀约定 */
export const StorageKeys = {
  materials: 'meta:materials',
  progress: 'meta:progress',
  favorites: 'meta:favorites',
  trainingRecords: 'meta:training-records',
  settings: 'meta:settings',
  ttsTasks: 'meta:tts-tasks'
} as const;
