/**
 * FileSaver 工厂（架构文档 §2.8）：条件编译选择实现。
 */
import type { FileSaver } from './types';

// #ifdef H5
import { WebSaver } from './web-saver';
// #endif

// #ifdef MP-WEIXIN
import { WxSaver } from './wx-saver';
// #endif

export function createFileSaver(): FileSaver {
  // #ifdef H5
  return new WebSaver();
  // #endif
  // #ifdef MP-WEIXIN
  return new WxSaver();
  // #endif
}

export type { FileSaver, SaveResult } from './types';
