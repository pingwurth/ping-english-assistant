/**
 * 录音适配器工厂（架构文档 §2.3）：条件编译选择实现。
 */
import type { RecorderController } from '@/core/recorder/types';

// #ifdef H5
import { RecorderJsAdapter } from './recorder-js';
// #endif

// #ifdef MP-WEIXIN
import { WxRecorderAdapter } from './wx-recorder';
// #endif

export function createRecorder(): RecorderController {
  // #ifdef H5
  return new RecorderJsAdapter();
  // #endif
  // #ifdef MP-WEIXIN
  return new WxRecorderAdapter();
  // #endif
}
