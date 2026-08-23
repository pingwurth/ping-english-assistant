/**
 * 小程序持久化（架构文档 §4.2）
 * - 元数据：uni.setStorage（<10MB 限额内）
 * - 媒体文件：FileSystemManager 保存到 USER_DATA_PATH
 *   导入时 chooseMessageFile 得到的临时文件需立即另存防止被清理。
 */
// #ifdef MP-WEIXIN
import type { StorageAdapter } from './types';

const USER_DATA_PATH = (uni as unknown as { env: { USER_DATA_PATH: string } }).env.USER_DATA_PATH;

export class WxStorage implements StorageAdapter {
  getMeta<T>(key: string): Promise<T | null> {
    return new Promise((resolve) => {
      uni.getStorage({
        key,
        success: (res) => resolve((res.data as T) ?? null),
        fail: () => resolve(null)
      });
    });
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      uni.setStorage({
        key,
        data: value,
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  removeMeta(key: string): Promise<void> {
    return new Promise((resolve) => {
      uni.removeStorage({ key, complete: () => resolve() });
    });
  }

  /** 将临时文件另存到 USER_DATA_PATH，返回持久化路径 */
  saveFile(data: Blob | string, fileName: string): Promise<string> {
    if (typeof data !== 'string') {
      return Promise.reject(new Error('小程序端文件保存需传临时文件路径'));
    }
    const target = `${USER_DATA_PATH}/material-${Date.now()}-${fileName}`;
    const fs = uni.getFileSystemManager();
    return new Promise((resolve, reject) => {
      fs.saveFile({
        tempFilePath: data,
        filePath: target,
        success: () => resolve(target),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  resolveFileSrc(ref: string): Promise<string> {
    // 小程序本地文件路径可直接用于播放
    return Promise.resolve(ref);
  }

  readTextFile(ref: string): Promise<string> {
    const fs = uni.getFileSystemManager();
    return new Promise((resolve, reject) => {
      fs.readFile({
        filePath: ref,
        encoding: 'utf8',
        success: (res) => resolve(String(res.data)),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
  }

  removeFile(ref: string): Promise<void> {
    const fs = uni.getFileSystemManager();
    return new Promise((resolve) => {
      fs.unlink({ filePath: ref, complete: () => resolve() });
    });
  }
}
// #endif
