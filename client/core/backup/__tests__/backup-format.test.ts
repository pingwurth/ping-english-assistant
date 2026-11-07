import { describe, expect, it } from 'vitest'
import { BACKUP_APP_ID, BACKUP_FORMAT_VERSION, parseBackupJson, planImport } from '../backup-format'

function validBackupJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: BACKUP_APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: 1750000000000,
    materials: [{ material: { id: 'm1', name: 'A' } }, { material: { id: 'm2', name: 'B' } }],
    records: { 'note:m1:0': { content: 'x' }, 'fav:m2:3': { createdAt: 1 } },
    prefs: { 'pref:rate': 1 },
    ...overrides,
  })
}

describe('parseBackupJson 校验', () => {
  it('合法备份解析成功，materials 归一化为 {id, value}', () => {
    const r = parseBackupJson(validBackupJson())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.materials.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(r.backup.materials[0]!.value).toEqual({ material: { id: 'm1', name: 'A' } })
    expect(r.backup.records['note:m1:0']).toEqual({ content: 'x' })
    expect(r.backup.prefs['pref:rate']).toBe(1)
    expect(r.backup.exportedAt).toBe(1750000000000)
  })

  it('接受旧版本格式（向前兼容）', () => {
    expect(parseBackupJson(validBackupJson({ formatVersion: 1 })).ok).toBe(true)
  })

  it('拒绝未来版本并提示升级', () => {
    const r = parseBackupJson(validBackupJson({ formatVersion: BACKUP_FORMAT_VERSION + 1 }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('升级') })
  })

  it('坏 JSON / 非对象 / app 不符 / 字段缺失分别给出可读错误', () => {
    expect(parseBackupJson('{oops').ok).toBe(false)
    expect(parseBackupJson('42').ok).toBe(false)
    expect(parseBackupJson(validBackupJson({ app: 'other-app' })).ok).toBe(false)
    expect(parseBackupJson(validBackupJson({ materials: 'x' })).ok).toBe(false)
    expect(parseBackupJson(validBackupJson({ records: [1] })).ok).toBe(false)
    expect(parseBackupJson(validBackupJson({ prefs: null })).ok).toBe(false)
    expect(parseBackupJson(validBackupJson({ media: 'x' }))).toEqual({ ok: false, error: '备份的 media 字段不正确' })
  })

  it('materials 中无有效 id 的项被剔除，不拒绝整份备份', () => {
    const r = parseBackupJson(validBackupJson({
      materials: [{ material: { id: 'ok' } }, { material: {} }, 'junk', null, { no: 'material' }],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.materials.map((m) => m.id)).toEqual(['ok'])
  })

  it('exportedAt 非数字时降级为 0（不崩）', () => {
    const r = parseBackupJson(validBackupJson({ exportedAt: 'yesterday' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.exportedAt).toBe(0)
  })

  it('records 仅保留普通对象值：null/数组/基元被剔除，不拒绝整份备份', () => {
    const r = parseBackupJson(validBackupJson({
      records: {
        'train:m1:0': { detail: { score: 1 } }, // 合法
        'bad:null': null,
        'bad:arr': [1, 2],
        'bad:num': 42,
        'bad:str': 'x',
      },
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.backup.records)).toEqual(['train:m1:0'])
  })

  it('prefs 仅保留基元值：嵌套对象/数组被剔除（localStorage 无法容纳）', () => {
    const r = parseBackupJson(validBackupJson({
      prefs: { 'pref:n': 1, 'pref:s': 'a', 'pref:o': { x: 1 }, 'pref:a': [1] },
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.prefs).toEqual({ 'pref:n': 1, 'pref:s': 'a' })
  })
})

describe('parseBackupJson media 清单', () => {
  it('轻量备份（无 media 字段）→ 空数组', () => {
    const r = parseBackupJson(validBackupJson())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.media).toEqual([])
  })

  it('合法 media 数组解析成功，缺省字段填默认值', () => {
    const r = parseBackupJson(validBackupJson({
      media: [
        { id: 'm1', fileName: 'a.mp3', mediaType: 'audio', mime: 'audio/mpeg', size: 10 },
        { id: 'm2', size: 0 },
      ],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.media[0]).toEqual({ id: 'm1', fileName: 'a.mp3', mediaType: 'audio', mime: 'audio/mpeg', size: 10 })
    expect(r.backup.media[1]).toEqual({ id: 'm2', fileName: '', mediaType: 'audio', mime: '', size: 0 })
  })

  it('脏条目剔除、重复 id 去重取先出现（不拒绝整份备份）', () => {
    const r = parseBackupJson(validBackupJson({
      media: [
        { id: 'm1', size: 5 },
        { id: 'm1', size: 9 },
        { id: '' },
        { no: 'id' },
        null, 'junk', 42,
        { id: 'm3', size: -1 },
        { id: 'm4', size: 'big' },
        { id: 'm5', size: 7, mediaType: 'video', fileName: 'v.mp4', mime: 'video/mp4' },
      ],
    }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.media).toEqual([
      { id: 'm1', fileName: '', mediaType: 'audio', mime: '', size: 5 },
      { id: 'm5', fileName: 'v.mp4', mediaType: 'video', mime: 'video/mp4', size: 7 },
    ])
  })

  it('完整备份形态（media + formatVersion 1）在当前版本可解析（钉死向前兼容契约）', () => {
    const r = parseBackupJson(validBackupJson({ formatVersion: 1, media: [{ id: 'm1', size: 1 }] }))
    expect(r).toEqual({ ok: true, backup: expect.objectContaining({ formatVersion: 1 }) })
  })
})

describe('parseBackupJson noteImages 清单', () => {
  it('v1 备份（无 noteImages 字段）→ 空数组', () => {
    const r = parseBackupJson(validBackupJson({ formatVersion: 1, media: [{ id: 'm1', size: 1 }] }))
    if (!r.ok) throw new Error(r.error)
    expect(r.backup.noteImages).toEqual([])
  })

  it('非数组给出可读错误', () => {
    expect(parseBackupJson(validBackupJson({ noteImages: 'x' }))).toEqual({ ok: false, error: '备份的 noteImages 字段不正确' })
  })

  it('合法条目解析成功，mime 缺省填空；非 noteimg: 前缀键/坏 size 剔除、按键去重', () => {
    const r = parseBackupJson(validBackupJson({
      noteImages: [
        { key: 'noteimg:m1:a', mime: 'image/webp', size: 10 },
        { key: 'noteimg:m1:b', size: 20 },
        { key: 'media:m1', size: 30 },
        { key: 'noteimg:m1:a', mime: 'image/png', size: 99 },
        { key: 'noteimg:m1:c', size: -1 },
        { key: 'noteimg:m1:d' },
      ],
    }))
    if (!r.ok) throw new Error(r.error)
    expect(r.backup.noteImages).toEqual([
      { key: 'noteimg:m1:a', mime: 'image/webp', size: 10 },
      { key: 'noteimg:m1:b', mime: '', size: 20 },
    ])
  })
})

describe('planImport 合并计划', () => {
  const entries = [
    { key: 'a', value: 1 },
    { key: 'b', value: 2 },
    { key: 'c', value: 3 },
  ]

  it('overwrite：全部写入，跳过 0', () => {
    expect(planImport(entries, new Set(['a']), 'overwrite')).toEqual({ toWrite: entries, skipped: 0 })
  })

  it('skipExisting：已有 key 跳过，新 key 写入', () => {
    const r = planImport(entries, new Set(['a', 'c']), 'skipExisting')
    expect(r.toWrite).toEqual([{ key: 'b', value: 2 }])
    expect(r.skipped).toBe(2)
  })

  it('空备份 / 全部已存在', () => {
    expect(planImport([], new Set(), 'skipExisting')).toEqual({ toWrite: [], skipped: 0 })
    const r = planImport(entries, new Set(['a', 'b', 'c']), 'skipExisting')
    expect(r.toWrite).toEqual([])
    expect(r.skipped).toBe(3)
  })
})
