/**
 * core/subtitle 单测：SRT/LRC 解析、双语拆分、BOM/CRLF、words 剥标点、坏文件带行号错误。
 */
import { describe, expect, it } from 'vitest'
import {
  parseSubtitle,
  parseSrt,
  parseLrc,
  parseSrtTimestamp,
  parseLrcTimestamp,
  isCJK,
  splitBilingual,
  splitWords,
  detectBilingual,
  SubtitleParseError,
} from '../index'
import { stripWordPunctuation } from '../bilingual'

describe('timestamp 解析', () => {
  it('SRT 时间戳 hh:mm:ss,mmm → ms（兼容 "." 分隔与短毫秒）', () => {
    expect(parseSrtTimestamp('00:00:02,610')).toBe(2610)
    expect(parseSrtTimestamp('01:02:03.5')).toBe(3723500)
    expect(parseSrtTimestamp('00:00:01,5')).toBe(1500) // "5" padEnd → 500ms
    expect(parseSrtTimestamp('bad')).toBeNull()
  })

  it('LRC 时间戳 [mm:ss.xx] → ms（兼容 ":" 毫秒与缺省毫秒）', () => {
    expect(parseLrcTimestamp('[00:12.30]')).toBe(12300)
    expect(parseLrcTimestamp('[01:05:99]')).toBe(65990) // 1-3 位分钟段允许
    expect(parseLrcTimestamp('[00:12]')).toBe(12000)
    expect(parseLrcTimestamp('[ti:title]')).toBeNull()
  })
})

describe('双语拆分与 words', () => {
  it('isCJK：中文/假名/谚文判中，纯英文判英', () => {
    expect(isCJK('你好世界')).toBe(true)
    expect(isCJK('こんにちは')).toBe(true)
    expect(isCJK('Hello world')).toBe(false)
    expect(isCJK("Don't stop")).toBe(false)
  })

  it('splitBilingual：上英下中 / 上中下英 / 单行 / 多行合并', () => {
    expect(splitBilingual(['Hello world', '你好世界'])).toEqual({ textEn: 'Hello world', textZh: '你好世界' })
    expect(splitBilingual(['你好世界', 'Hello world'])).toEqual({ textEn: 'Hello world', textZh: '你好世界' })
    expect(splitBilingual(['Only english'])).toEqual({ textEn: 'Only english', textZh: null })
    expect(splitBilingual(['part one', 'part two', '中文一行'])).toEqual({ textEn: 'part one part two', textZh: '中文一行' })
    expect(splitBilingual([])).toEqual({ textEn: '', textZh: null })
  })

  it('splitWords：剥首尾标点、保留内部撇号、过滤空串', () => {
    expect(splitWords("Well, don't you think?")).toEqual(['Well', "don't", 'you', 'think'])
    expect(splitWords('"Quoted!" (yes)')).toEqual(['Quoted', 'yes'])
    expect(stripWordPunctuation('...')).toBe('')
    expect(splitWords('')).toEqual([])
  })
})

describe('parseSubtitle SRT', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:03,000',
    'Good morning.',
    '早上好。',
    '',
    '2',
    '00:00:03,500 --> 00:00:05,000',
    'Nice to meet you.',
    '',
  ].join('\n')

  it('基础解析：双语拆分、words、总时长', () => {
    const data = parseSubtitle(srt)
    expect(data.format).toBe('srt')
    expect(data.isBilingual).toBe(true)
    expect(data.sentences).toHaveLength(2)
    expect(data.sentences[0]).toMatchObject({ index: 0, startMs: 1000, endMs: 3000, textEn: 'Good morning.', textZh: '早上好。' })
    expect(data.sentences[0]!.words).toEqual(['Good', 'morning'])
    expect(data.sentences[1]!.textZh).toBeNull()
    expect(data.totalDurationMs).toBe(5000)
  })

  it('BOM + CRLF 兼容', () => {
    const crlf = '\uFEFF' + srt.replace(/\n/g, '\r\n')
    const data = parseSubtitle(crlf)
    expect(data.sentences).toHaveLength(2)
    expect(data.sentences[0]!.textEn).toBe('Good morning.')
  })

  it('序号缺失时按出现顺序解析（容错）', () => {
    const text = '00:00:00,000 --> 00:00:01,000\nHi there\n'
    const data = parseSubtitle(text)
    expect(data.sentences).toHaveLength(1)
    expect(data.sentences[0]!.textEn).toBe('Hi there')
  })

  it('乱序块按 startMs 排序且 index 重排', () => {
    const text = ['1', '00:00:05,000 --> 00:00:06,000', 'Later', '', '2', '00:00:01,000 --> 00:00:02,000', 'Earlier', ''].join('\n')
    const data = parseSubtitle(text)
    expect(data.sentences.map((s) => s.textEn)).toEqual(['Earlier', 'Later'])
    expect(data.sentences.map((s) => s.index)).toEqual([0, 1])
  })

  it('显式指定 format=srt 时不做嗅探', () => {
    const data = parseSubtitle('00:00:00,000 --> 00:00:01,000\nHello', 'srt')
    expect(data.format).toBe('srt')
  })
})

describe('parseSubtitle LRC', () => {
  const lrc = ['[ti:Demo]', '[00:01.00]First line', '[00:03.00]Second line', '[00:06.00]Last line'].join('\n')

  it('元数据行跳过；endMs=下一句 startMs，末句 endMs=totalDurationMs', () => {
    const data = parseSubtitle(lrc)
    expect(data.format).toBe('lrc')
    expect(data.sentences).toHaveLength(3)
    expect(data.sentences[0]).toMatchObject({ startMs: 1000, endMs: 3000 })
    expect(data.sentences[1]).toMatchObject({ startMs: 3000, endMs: 6000 })
    expect(data.sentences[2]).toMatchObject({ startMs: 6000, endMs: 6000 })
    expect(data.totalDurationMs).toBe(6000)
  })

  it('knownDurationMs 回填末句 endMs（避免末句零时长）', () => {
    const data = parseSubtitle(lrc, undefined, 8200)
    expect(data.sentences[0]).toMatchObject({ startMs: 1000, endMs: 3000 })
    expect(data.sentences[2]).toMatchObject({ startMs: 6000, endMs: 8200 })
    expect(data.totalDurationMs).toBe(8200)
  })

  it('knownDurationMs 不晚于末句起点 → 保持退化（末句 endMs=startMs）', () => {
    const data = parseSubtitle(lrc, undefined, 5000)
    expect(data.sentences[2]!.endMs).toBe(6000)
    expect(data.totalDurationMs).toBe(6000)
  })

  it('一行多时间标签展开为多句', () => {
    const blocks = parseLrc('[00:12.30][01:12.30]Repeat me')
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.startMs)).toEqual([12300, 72300])
    expect(blocks.every((b) => b.lines[0] === 'Repeat me')).toBe(true)
  })

  it('BOM + CRLF 兼容', () => {
    const data = parseSubtitle('\uFEFF' + lrc.replace(/\n/g, '\r\n'))
    expect(data.sentences).toHaveLength(3)
  })
})

describe('错误路径：SubtitleParseError 带行号', () => {
  it('空内容抛错', () => {
    expect(() => parseSubtitle('   ')).toThrowError(SubtitleParseError)
  })

  it('无法识别的格式抛错', () => {
    expect(() => parseSubtitle('this is not a subtitle')).toThrowError(SubtitleParseError)
  })

  it('SRT 时间戳行损坏 → 错误带块首行号', () => {
    const text = ['1', '00:00:xx,000 --> 00:00:01,000', 'Hello'].join('\n')
    try {
      parseSubtitle(text)
      expect.unreachable('应当抛出')
    } catch (e) {
      expect(e).toBeInstanceOf(SubtitleParseError)
      expect((e as SubtitleParseError).line).toBe(1)
    }
  })

  it('时间戳前出现杂散文本 → 抛错', () => {
    const text = ['garbage', '00:00:00,000 --> 00:00:01,000', 'Hello'].join('\n')
    expect(() => parseSubtitle(text)).toThrowError(SubtitleParseError)
  })

  it('parseLrc 无任何歌词行 → 抛错（经 parseSubtitle 时表现为格式无法识别）', () => {
    expect(() => parseLrc('[ti:Only meta]')).toThrowError(SubtitleParseError)
  })

  it('parseSrt 空块集合 → 抛错', () => {
    expect(() => parseSrt('   \n  \n')).toThrowError(SubtitleParseError)
  })
})

describe('防御性：畸形/恶意输入不得卡死（线性时间解析，无回溯型块正则）', () => {
  it('超长无空行文本：毫秒级完成解析或抛错，不挂起', () => {
    const junk = 'a'.repeat(200_000) + ' ' + 'b'.repeat(200_000)
    // ① 无时间轴的超长单块：快速抛 SubtitleParseError
    let t0 = performance.now()
    expect(() => parseSrt(junk)).toThrowError(SubtitleParseError)
    expect(performance.now() - t0).toBeLessThan(500)
    // ② 带合法时间轴的超长单块：正常解析为 1 句，不挂起
    const text = `00:00:00,000 --> 00:00:01,000\n${junk}`
    t0 = performance.now()
    const data = parseSubtitle(text)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(data.sentences).toHaveLength(1)
  })

  it('大量伪时间戳行无空行分隔：快速失败或解析，不挂起', () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `00:00:${String(i % 60).padStart(2, '0')},000 not-a-timing-line`).join('\n')
    const t0 = performance.now()
    expect(() => parseSrt(lines)).toThrowError(SubtitleParseError)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('detectBilingual', () => {
  it('中文句占比 >30% 才判双语', () => {
    expect(detectBilingual([])).toBe(false)
    expect(detectBilingual([{ textZh: '中' }, { textZh: null }, { textZh: null }])).toBe(true) // 1/3 > 0.3
    expect(detectBilingual([{ textZh: '中' }, { textZh: null }, { textZh: null }, { textZh: null }])).toBe(false) // 1/4
    expect(detectBilingual([{ textZh: '' }, { textZh: null }])).toBe(false) // 空串不计
  })
})
