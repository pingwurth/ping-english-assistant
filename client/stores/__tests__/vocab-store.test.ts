/**
 * vocab-store 单测 —— node 下 idb 自动走内存兜底。
 * 重点：词条删除的从属清理（mnemonic:{entryId} 不留孤儿，评审 #20）
 * 与启动清扫对历史孤儿的治愈。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECORD_KEYS } from '@/platform/storage/schema'

let idb: typeof import('@/platform/storage/idb')
let vs: typeof import('@/stores/vocab-store')

/** 每个用例全新模块实例（内存 store 是模块级单例，reset 才能互不串扰） */
beforeEach(async () => {
  vi.resetModules()
  idb = await import('@/platform/storage/idb')
  vs = await import('@/stores/vocab-store')
})

describe('词条删除的从属清理（评审 #20）', () => {
  it('removeEntry 连带删除 mnemonic 缓存', async () => {
    await vs.initVocab()
    const entry = await vs.addEntry({ text: 'apple', context: 'an apple', materialId: 'm-1', sentenceIndex: 0, bookId: 'default' })
    const { recordsStore } = idb
    await recordsStore.put(RECORD_KEYS.mnemonic(entry.id), { id: entry.id, card: {}, createdAt: 1 })

    await vs.removeEntry(entry.id)

    expect(await recordsStore.get(RECORD_KEYS.vocabEntry(entry.id))).toBeUndefined()
    expect(await recordsStore.get(RECORD_KEYS.mnemonic(entry.id))).toBeUndefined()
  })

  it('clearEntriesByBook 连带删除 mnemonic 缓存', async () => {
    await vs.initVocab()
    const entry = await vs.addEntry({ text: 'banana', context: '', materialId: 'm-1', sentenceIndex: 0, bookId: 'default' })
    const { recordsStore } = idb
    await recordsStore.put(RECORD_KEYS.mnemonic(entry.id), { id: entry.id })

    await vs.clearEntriesByBook('default')

    expect(await recordsStore.get(RECORD_KEYS.mnemonic(entry.id))).toBeUndefined()
  })

  it('启动清扫治愈历史孤儿 mnemonic（无 sweep 兜底则永久累积）', async () => {
    // 直接落库一条无主 mnemonic（模拟旧版本删除路径留下的孤儿）
    const { recordsStore } = idb
    await recordsStore.put(RECORD_KEYS.mnemonic('ghost-entry'), { id: 'ghost-entry' })

    await vs.initVocab()

    expect(await recordsStore.get(RECORD_KEYS.mnemonic('ghost-entry'))).toBeUndefined()
  })

  it('启动清扫不误删在册词条的 mnemonic', async () => {
    // resetModules 会换全新空内存库，无法模拟「重启」；在同一实例内先落库再 init
    const { recordsStore } = idb
    await recordsStore.put(RECORD_KEYS.vocabEntry('e-live'), {
      id: 'e-live', text: 'cherry', context: '', materialId: 'm-1', sentenceIndex: 0,
      bookId: 'default', addedAt: 1, frequency: 0,
    } satisfies import('@/types/vocabulary').VocabEntry)
    await recordsStore.put(RECORD_KEYS.mnemonic('e-live'), { id: 'e-live' })
    await recordsStore.put(RECORD_KEYS.mnemonic('ghost'), { id: 'ghost' })

    await vs.initVocab()

    expect(await recordsStore.get(RECORD_KEYS.mnemonic('e-live'))).toBeDefined()
    expect(await recordsStore.get(RECORD_KEYS.mnemonic('ghost'))).toBeUndefined()
  })
})
