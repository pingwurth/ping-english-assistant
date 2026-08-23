/** CJK 判定工具（复用 core 层实现，供 UI 层直接使用） */
export { isCJK } from '@/core/subtitle/bilingual';

/** 检测文本是否以英文为主（TTS 输入校验：非英文时提示但不阻断） */
export function isMostlyEnglish(text: string): boolean {
  const letters = text.replace(/\s/g, '');
  if (!letters) return true;
  const cjk = (letters.match(/[぀-ヿ㐀-䶿一-鿿]/g) ?? []).length;
  return cjk / letters.length < 0.1;
}
