/**
 * 媒体导出 handoff 回归（三轮复审 c005 补测）：写入时间标记的原子写、TTL 宽限、
 * 孤儿标记对账清扫。node 环境无 sessionStorage → 旧版键一律按孤儿处理，正好
 * 覆盖「无标记回落旧判定」分支。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { createMediaExportHandoff } from '../media-export-handoff'

let idb: typeof import('@/platform/storage/idb')
let handoff: typeof createMediaExportHandoff

/** 每用例全新模块实例（内存 blobs store 是模块级单例，须与被测工厂共享同一实例）。
 *  注意：运行时 Node ≥22 自带 sessionStorage（web storage）——同 tab 索引会真实
 *  存在，跨 tab/孤儿场景须显式 removeItem 模拟。 */
beforeEach(async () => {
  vi.resetModules()
  idb = await import('@/platform/storage/idb')
  ;({ createMediaExportHandoff: handoff } = await import('../media-export-handoff'))
  try { sessionStorage.clear() } catch { /* 无 web storage 的环境忽略 */ }
})

const BLOB_PREFIX = 'tts-export:'
const SESSION_PREFIX = 'ping-english:tts-export:'

function makeHandoff() {
  return handoff<{ taskId: string; subtitleText: string; subtitleFormat: string }>({
    sessionPrefix: SESSION_PREFIX,
    blobKeyPrefix: BLOB_PREFIX,
  })
}

async function allBlobKeys(): Promise<string[]> {
  return (await idb.blobsStore.allKeys()).sort()
}

describe('媒体导出 handoff（c008 原子写 + c013 对账）', () => {
  it('write 同批写入音频与 ts 宽限标记;consume 一并清理', async () => {
    const h = makeHandoff()
    await h.write('task-1', new Blob(['abc']), { subtitleText: 's', subtitleFormat: 'srt' })
    expect(await allBlobKeys()).toEqual([`${BLOB_PREFIX}task-1`, `${BLOB_PREFIX}ts:task-1`].sort())
    await h.consume('task-1')
    expect(await allBlobKeys()).toEqual([])
  })

  it('TTL 内的在途产物（可能属于其他标签页）不被下次 write 的清扫删除', async () => {
    const h = makeHandoff()
    await h.write('old-tab', new Blob(['x']), { subtitleText: 's', subtitleFormat: 'srt' })
    // 模拟跨标签页：本 tab 无 old-tab 的 sessionStorage 索引（node 自带 storage,须显式移除）
    try { sessionStorage.removeItem(`${SESSION_PREFIX}old-tab`) } catch { /* 无 web storage */ }
    await h.write('new-tab', new Blob(['y']), { subtitleText: 's', subtitleFormat: 'srt' })
    // old-tab 无本 tab 索引,但 ts 标记在宽限期内 → 保留（c008 跨 tab 宽限核心）
    expect(await allBlobKeys()).toContain(`${BLOB_PREFIX}old-tab`)
    expect(await allBlobKeys()).toContain(`${BLOB_PREFIX}new-tab`)
  })

  it('超 TTL 的产物连同其标记被清扫;旧版无标记键按孤儿删除', async () => {
    const h = makeHandoff()
    await h.write('stale', new Blob(['x']), { subtitleText: 's', subtitleFormat: 'srt' })
    await h.write('legacy', new Blob(['y']), { subtitleText: 's', subtitleFormat: 'srt' })
    // 把 stale 的时间标记拨回 11 分钟前(超过 10min 宽限);legacy 直接抹掉标记模拟旧版键,
    // 并移除本 tab 的 sessionStorage 索引(旧判定按「无索引=孤儿」处理,如别的 tab 写入的)
    await idb.blobsStore.put(`${BLOB_PREFIX}ts:stale`, Date.now() - 11 * 60 * 1000)
    await idb.blobsStore.delete(`${BLOB_PREFIX}ts:legacy`)
    try { sessionStorage.removeItem(`${SESSION_PREFIX}legacy`) } catch { /* 无 web storage */ }
    // 触发一次 write → 写前清扫
    await h.write('fresh', new Blob(['z']), { subtitleText: 's', subtitleFormat: 'srt' })
    const keys = await allBlobKeys()
    expect(keys).not.toContain(`${BLOB_PREFIX}stale`)
    expect(keys).not.toContain(`${BLOB_PREFIX}ts:stale`) // 标记随宿主清理
    expect(keys).not.toContain(`${BLOB_PREFIX}legacy`) // 无标记 → 旧判定 → 孤儿
    expect(keys).toContain(`${BLOB_PREFIX}fresh`)
  })

  it('孤儿 ts 标记（宿主经其它路径消失）被对账清扫', async () => {
    const h = makeHandoff()
    await h.write('gone', new Blob(['x']), { subtitleText: 's', subtitleFormat: 'srt' })
    // 模拟宿主 blob 经其它路径消失（如并发 consume 竞态）
    await idb.blobsStore.delete(`${BLOB_PREFIX}gone`)
    await h.write('next', new Blob(['y']), { subtitleText: 's', subtitleFormat: 'srt' })
    const keys = await allBlobKeys()
    expect(keys).not.toContain(`${BLOB_PREFIX}ts:gone`) // c013:无宿主标记不再残留
  })
})
