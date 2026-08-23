/**
 * 持久化工厂（架构文档 §4.2）：条件编译选择实现。
 */
import type { StorageAdapter } from './types';

// #ifdef H5
import { IdbStorage } from './idb';
// #endif

// #ifdef MP-WEIXIN
import { WxStorage } from './wx-storage';
// #endif

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!instance) {
    // #ifdef H5
    instance = new IdbStorage();
    // #endif
    // #ifdef MP-WEIXIN
    instance = new WxStorage();
    // #endif
  }
  return instance!;
}

export type { StorageAdapter } from './types';
export { StorageKeys } from './types';
