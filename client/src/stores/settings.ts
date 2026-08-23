/**
 * 设置 Store（架构文档 §2.6 · 原型设计 §4.11）
 * 默认倍速、循环次数、录音交互方式、耳机提示开关、后台播放开关；持久化到本地。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getStorage, StorageKeys } from '@/platform/storage';

export interface AppSettings {
  /** 默认倍速 */
  defaultRate: number;
  /** 单句循环默认次数：1 / 3 / Infinity */
  loopTimes: number;
  /** 字幕默认三态 */
  subtitleMode: 'both' | 'en' | 'zh' | 'off';
  /** 录音交互：按住说话 / 点按开始结束 */
  recordMode: 'hold' | 'tap';
  /** 影子跟读耳机提示 */
  headphoneTipEnabled: boolean;
  /** 小程序后台播放（BackgroundAudioManager） */
  backgroundPlay: boolean;
}

const DEFAULTS: AppSettings = {
  defaultRate: 1.0,
  loopTimes: 3,
  subtitleMode: 'both',
  recordMode: 'hold',
  headphoneTipEnabled: true,
  backgroundPlay: false
};

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULTS });

  function restore(): void {
    // #ifdef H5
    try {
      const raw = localStorage.getItem(StorageKeys.settings);
      if (raw) settings.value = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    // #endif
    // #ifdef MP-WEIXIN
    try {
      const data = uni.getStorageSync(StorageKeys.settings) as Partial<AppSettings> | '';
      if (data) settings.value = { ...DEFAULTS, ...data };
    } catch {
      /* ignore */
    }
    // #endif
  }

  async function update(patch: Partial<AppSettings>): Promise<void> {
    settings.value = { ...settings.value, ...patch };
    await getStorage().setMeta(StorageKeys.settings, settings.value);
  }

  return { settings, restore, update };
});
