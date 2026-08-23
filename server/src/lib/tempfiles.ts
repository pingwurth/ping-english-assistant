/**
 * 临时文件管理（架构文档 §3.5 上传安全）
 * 写后即删（finally 清理）+ 定期清扫；录音默认即用即删。
 */
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DIR = join(tmpdir(), 'ping-english-assistant');

export async function ensureTmpDir(): Promise<void> {
  await mkdir(DIR, { recursive: true });
}

/** 流式落盘并计算内容哈希（缓存键用） */
export async function saveUpload(stream: Readable, ext: string): Promise<{ path: string; hash: string }> {
  await ensureTmpDir();
  const path = join(DIR, `${randomUUID()}.${ext}`);
  const hash = createHash('sha256');
  stream.on('data', (chunk) => hash.update(chunk));
  await pipeline(stream, createWriteStream(path));
  return { path, hash: hash.digest('hex') };
}

export async function writeTmpFile(content: Buffer | string, ext: string): Promise<string> {
  await ensureTmpDir();
  const path = join(DIR, `${randomUUID()}.${ext}`);
  await writeFile(path, content);
  return path;
}

export async function cleanup(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

/** 定期清扫超过 maxAgeMs 的临时文件（录音即用即删兜底） */
export async function sweep(maxAgeMs = 3600_000): Promise<void> {
  await ensureTmpDir();
  const now = Date.now();
  for (const name of await readdir(DIR)) {
    const p = join(DIR, name);
    const s = await stat(p).catch(() => null);
    if (s && now - s.mtimeMs > maxAgeMs) await rm(p, { force: true }).catch(() => undefined);
  }
}
