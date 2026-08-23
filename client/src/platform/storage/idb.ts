/**
 * H5 持久化：IndexedDB（idb 封装，架构文档 §4.2）
 * - meta store：材料/进度/收藏/训练记录等 JSON 元数据
 * - file store：媒体/字幕 Blob（或迁移 OPFS，Chrome 86+，后续迭代）
 */
// #ifdef H5
import { openDB, type IDBPDatabase } from 'idb';
import type { StorageAdapter } from './types';

const DB_NAME = 'ping-english-assistant';
const DB_VERSION = 1;
const META_STORE = 'meta';
const FILE_STORE = 'files';

export class IdbStorage implements StorageAdapter {
  private dbPromise: Promise<IDBPDatabase> | null = null;

  private db(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
          if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
        }
      });
    }
    return this.dbPromise;
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const db = await this.db();
    const v = await db.get(META_STORE, key);
    return (v ?? null) as T | null;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    await db.put(META_STORE, value, key);
  }

  async removeMeta(key: string): Promise<void> {
    const db = await this.db();
    await db.delete(META_STORE, key);
  }

  async saveFile(data: Blob | string, fileName: string): Promise<string> {
    const db = await this.db();
    const ref = `file:${Date.now()}:${fileName}`;
    const blob = typeof data === 'string' ? await fetch(data).then((r) => r.blob()) : data;
    await db.put(FILE_STORE, blob, ref);
    return ref;
  }

  async resolveFileSrc(ref: string): Promise<string> {
    const db = await this.db();
    const blob = (await db.get(FILE_STORE, ref)) as Blob | undefined;
    if (!blob) throw new Error(`文件不存在: ${ref}`);
    return URL.createObjectURL(blob);
  }

  async readTextFile(ref: string): Promise<string> {
    const db = await this.db();
    const blob = (await db.get(FILE_STORE, ref)) as Blob | undefined;
    if (!blob) throw new Error(`文件不存在: ${ref}`);
    return blob.text();
  }

  async removeFile(ref: string): Promise<void> {
    const db = await this.db();
    await db.delete(FILE_STORE, ref);
  }
}
// #endif
