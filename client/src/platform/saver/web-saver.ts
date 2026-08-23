/**
 * Web 文件保存：Blob → a[download] 触发浏览器下载（架构文档 §2.8）
 * PC / 移动 H5 通用；iOS Safari 存入"文件"App 下载项。
 */
// #ifdef H5
import type { FileSaver, SaveResult } from './types';

export class WebSaver implements FileSaver {
  async saveAudio(data: Blob | string, fileName: string): Promise<SaveResult> {
    const blob = typeof data === 'string' ? await fetch(data).then((r) => r.blob()) : data;
    return this.download(blob, fileName);
  }

  async saveText(text: string, fileName: string): Promise<SaveResult> {
    return this.download(new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName);
  }

  private download(blob: Blob, fileName: string): Promise<SaveResult> {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟回收，确保下载已启动
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return Promise.resolve({
      locationText: '浏览器默认下载目录（通常为 ~/Downloads）',
      localRef: url
    });
  }
}
// #endif
