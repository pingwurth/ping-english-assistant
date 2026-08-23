/**
 * 播放器工厂（架构文档 §2.2）：条件编译选择实现，调用方无感知。
 */
import type { PlayerController } from '@/core/player/types';

// #ifdef H5
import { ArtPlayerAdapter } from './art-player';
import { HowlerAdapter } from './howler';
// #endif

// #ifdef MP-WEIXIN
import { MpVideoAdapter } from './mp-video';
import { MpInnerAudioAdapter } from './mp-audio';
// #endif

export function createPlayer(type: 'video' | 'audio'): PlayerController {
  // #ifdef H5
  return type === 'video' ? new ArtPlayerAdapter() : new HowlerAdapter();
  // #endif
  // #ifdef MP-WEIXIN
  return type === 'video' ? new MpVideoAdapter() : new MpInnerAudioAdapter();
  // #endif
}
