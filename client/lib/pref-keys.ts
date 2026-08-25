/**
 * 设置项（prefs）键位与取值约定 —— P10 设置页读写、P2 播放器读取默认值。
 * 存储走 platform/storage/prefs.ts（localStorage，`ping-english:` 前缀）。
 */

import { getPref, setPref } from '@/platform/storage/prefs'

export type PrefRate = 0.75 | 1 | 1.25
export type PrefLoop = 0 | 1 | 3 | 'inf'
export type PrefRecordMode = 'hold' | 'tap'

/** 默认倍速循环序列（与播放器倍速按钮同档位） */
export const PREF_RATES: PrefRate[] = [0.75, 1, 1.25]
/** 单句循环次数档位：关(0) / 1 / 3 / ∞ */
export const PREF_LOOPS: PrefLoop[] = [0, 1, 3, 'inf']

export function getDefaultRate(): PrefRate {
  const v = getPref<number>('pref:rate', 1)
  return (PREF_RATES.find((r) => r === v) ?? 1) as PrefRate
}
export function setDefaultRate(v: PrefRate): void { setPref('pref:rate', v) }

export function getDefaultLoop(): PrefLoop {
  const v = getPref<PrefLoop>('pref:loop', 0)
  return PREF_LOOPS.includes(v) ? v : 0
}
export function setDefaultLoop(v: PrefLoop): void { setPref('pref:loop', v) }

export function getRecordMode(): PrefRecordMode {
  return getPref<PrefRecordMode>('pref:recordMode', 'hold') === 'tap' ? 'tap' : 'hold'
}
export function setRecordMode(v: PrefRecordMode): void { setPref('pref:recordMode', v) }

export function getHeadphoneHint(): boolean {
  return getPref<boolean>('pref:headphoneHint', true)
}
export function setHeadphoneHint(v: boolean): void { setPref('pref:headphoneHint', v) }
