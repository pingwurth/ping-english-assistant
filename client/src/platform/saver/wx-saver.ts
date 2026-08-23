/**
 * 小程序文件保存：wx.saveFileToDisk（基础库 2.27.1+，用户自选目录）
 * 不支持的客户端兜底 wx.shareFileMessage 发送到聊天（架构文档 §2.8）。
 */
// #ifdef MP-WEIXIN
import type { FileSaver, SaveResult } from './types';

declare const wx: {
  saveFileToDisk(options: {
    filePath: string;
    success?: (res: { savedFilePath: string }) => void;
    fail?: (err: { errMsg: string }) => void;
  }): void;
  shareFileMessage(options: {
    filePath: string;
    fileName?: string;
    success?: () => void;
    fail?: (err: { errMsg: string }) => void;
  }): void;
};

export class WxSaver implements FileSaver {
  async saveAudio(data: Blob | string, fileName: string): Promise<SaveResult> {
    if (typeof data !== 'string') throw new Error('小程序端音频保存需传临时文件路径');
    return this.saveToDisk(data, fileName);
  }

  async saveText(text: string, fileName: string): Promise<SaveResult> {
    // 文本先写入用户文件目录临时文件，再走同一保存链路
    const fs = uni.getFileSystemManager();
    const filePath = `${(uni as unknown as { env: { USER_DATA_PATH: string } }).env.USER_DATA_PATH}/${fileName}`;
    await new Promise<void>((resolve, reject) => {
      fs.writeFile({
        filePath,
        data: text,
        encoding: 'utf8',
        success: () => resolve(),
        fail: (err) => reject(new Error(err.errMsg))
      });
    });
    return this.saveToDisk(filePath, fileName);
  }

  private saveToDisk(filePath: string, fileName: string): Promise<SaveResult> {
    return new Promise((resolve, reject) => {
      if (typeof wx !== 'undefined' && wx.saveFileToDisk) {
        wx.saveFileToDisk({
          filePath,
          success: (res) =>
            resolve({ locationText: res.savedFilePath, localRef: res.savedFilePath }),
          fail: (err) => {
            // 用户取消不视为错误；其余失败走兜底
            if (err.errMsg.includes('cancel')) {
              reject(new Error('已取消保存'));
            } else {
              this.fallbackShare(filePath, fileName).then(resolve, reject);
            }
          }
        });
      } else {
        this.fallbackShare(filePath, fileName).then(resolve, reject);
      }
    });
  }

  /** 兜底：发送到聊天（旧基础库） */
  private fallbackShare(filePath: string, fileName: string): Promise<SaveResult> {
    return new Promise((resolve, reject) => {
      wx.shareFileMessage({
        filePath,
        fileName,
        success: () =>
          resolve({ locationText: '已发送到微信聊天（文件传输助手等）', localRef: filePath }),
        fail: (err) => reject(new Error(err.errMsg || '保存失败'))
      });
    });
  }
}
// #endif
