/**
 * 简易 LRU 缓存（带 TTL），用于 SOE 结果 / LLM 报告 / TTS 字幕缓存（架构文档 §3.5）
 */
export class LruCache<V> {
  private map = new Map<string, { value: V; expireAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number
  ) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expireAt) {
      this.map.delete(key);
      return undefined;
    }
    // LRU：命中后移到末尾
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expireAt: Date.now() + this.ttlMs });
  }
}
