import { describe, expect, it } from 'vitest'
import { parseNoteMarkdown, tokenizeInline } from '../note-markdown'

describe('tokenizeInline 行内记号', () => {
  it('纯文本原样返回', () => {
    expect(tokenizeInline('hello world')).toEqual([{ type: 'text', text: 'hello world' }])
  })

  it('粗体/斜体/高亮/行内码切分', () => {
    expect(tokenizeInline('**粗**')).toEqual([{ type: 'bold', text: '粗' }])
    expect(tokenizeInline('*斜*')).toEqual([{ type: 'italic', text: '斜' }])
    expect(tokenizeInline('==高==')).toEqual([{ type: 'mark', text: '高' }])
    expect(tokenizeInline('`code`')).toEqual([{ type: 'code', text: 'code' }])
  })

  it('混合文本按顺序切分（** 优先于 *，避免粗体被吃成斜体）', () => {
    expect(tokenizeInline('a **b** c *d* e')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' c ' },
      { type: 'italic', text: 'd' },
      { type: 'text', text: ' e' },
    ])
  })

  it('未闭合的记号保持原文本', () => {
    expect(tokenizeInline('2 * 3 = 6')).toEqual([{ type: 'text', text: '2 * 3 = 6' }])
    expect(tokenizeInline('a == b')).toEqual([{ type: 'text', text: 'a == b' }])
  })
})

describe('parseNoteMarkdown 块级解析', () => {
  it('空串返回空数组', () => {
    expect(parseNoteMarkdown('')).toEqual([])
    expect(parseNoteMarkdown('   \n  ')).toEqual([])
  })

  it('标题三级', () => {
    const blocks = parseNoteMarkdown('# 一级\n## 二级\n### 三级')
    expect(blocks).toEqual([
      { type: 'heading', level: 1, inline: [{ type: 'text', text: '一级' }] },
      { type: 'heading', level: 2, inline: [{ type: 'text', text: '二级' }] },
      { type: 'heading', level: 3, inline: [{ type: 'text', text: '三级' }] },
    ])
  })

  it('连续列表项归并为一个列表，空行分段', () => {
    const blocks = parseNoteMarkdown('- a\n- **b**\n\n- c')
    expect(blocks).toEqual([
      { type: 'list', items: [[{ type: 'text', text: 'a' }], [{ type: 'bold', text: 'b' }]] },
      { type: 'list', items: [[{ type: 'text', text: 'c' }]] },
    ])
  })

  it('引用归并，引用与列表互相打断', () => {
    const blocks = parseNoteMarkdown('> 引用一\n> 引用二\n- 列表')
    expect(blocks).toEqual([
      { type: 'quote', lines: [[{ type: 'text', text: '引用一' }], [{ type: 'text', text: '引用二' }]] },
      { type: 'list', items: [[{ type: 'text', text: '列表' }]] },
    ])
  })

  it('围栏代码块：内部不解析任何语法，未闭合也成块', () => {
    const blocks = parseNoteMarkdown('```\n**not bold**\n| a |\n```')
    expect(blocks).toEqual([{ type: 'code', text: '**not bold**\n| a |' }])
    expect(parseNoteMarkdown('```\nabc')).toEqual([{ type: 'code', text: 'abc' }])
  })

  it('表格：分隔行识别表头，行内码在单元格内生效', () => {
    const blocks = parseNoteMarkdown('| A | B |\n| --- | --- |\n| `x` | y |')
    expect(blocks).toEqual([{
      type: 'table',
      header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
      rows: [[[{ type: 'code', text: 'x' }], [{ type: 'text', text: 'y' }]]],
    }])
  })

  it('表格无分隔行时全部视为数据行', () => {
    const blocks = parseNoteMarkdown('| a | b |\n| c | d |')
    expect(blocks).toEqual([{
      type: 'table',
      header: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]],
      rows: [[[{ type: 'text', text: 'c' }], [{ type: 'text', text: 'd' }]]],
    }])
  })

  it('CRLF 与混合块顺序', () => {
    const blocks = parseNoteMarkdown('# T\r\n\r\n段落 *x*\r\n\r\n> q')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote'])
    expect(blocks[1]).toEqual({ type: 'paragraph', inline: [{ type: 'text', text: '段落 ' }, { type: 'italic', text: 'x' }] })
  })
})
