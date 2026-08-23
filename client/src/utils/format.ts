/** 展示格式化工具 */
import { formatMs } from '@/core/subtitle/timestamp';

export { formatMs };

/** 字节数 → 可读大小 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 相对时间：昨天 / N 天前 / 从未学习 */
export function formatRelativeTime(ts: number | null | undefined): string {
  if (!ts) return '从未学习';
  const dayMs = 86400000;
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const thatDayStart = new Date(ts).setHours(0, 0, 0, 0);
  const diffDays = Math.round((todayStart - thatDayStart) / dayMs);
  if (diffDays <= 0) return '今天学过';
  if (diffDays === 1) return '昨天学过';
  return `${diffDays} 天前`;
}

/** 进度百分比 */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}
