import { describe, expect, it } from 'vitest'
import { enclosingCenter, parseNoteMarkdown, tokenizeInline, type NoteListItem } from '../note-markdown'

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

  it('行内公式 $..$ 与展示公式 $$..$$（$$ 优先于 $）', () => {
    expect(tokenizeInline('$E=mc^2$')).toEqual([{ type: 'math', text: 'E=mc^2', display: false }])
    expect(tokenizeInline('$$\\frac{a}{b}$$')).toEqual([{ type: 'math', text: '\\frac{a}{b}', display: true }])
    expect(tokenizeInline('$x$')).toEqual([{ type: 'math', text: 'x', display: false }])
  })

  it('公式与普通文本混排', () => {
    expect(tokenizeInline('质能 $E=mc^2$ 公式')).toEqual([
      { type: 'text', text: '质能 ' },
      { type: 'math', text: 'E=mc^2', display: false },
      { type: 'text', text: ' 公式' },
    ])
  })

  it('货币美元不误判：内侧空白 / 闭合后紧跟数字 / 未闭合', () => {
    expect(tokenizeInline('paid $5 and $10')).toEqual([{ type: 'text', text: 'paid $5 and $10' }])
    expect(tokenizeInline('range $5-$10 ok')).toEqual([{ type: 'text', text: 'range $5-$10 ok' }])
    expect(tokenizeInline('a $ x $ b')).toEqual([{ type: 'text', text: 'a $ x $ b' }])
    expect(tokenizeInline('花了$3和$4呢')).toEqual([{ type: 'text', text: '花了$3和$4呢' }])
    expect(tokenizeInline('only $')).toEqual([{ type: 'text', text: 'only $' }])
  })

  it('行内码里的 $ 不当公式（位置在前的记号先消费）', () => {
    expect(tokenizeInline('`$x$`')).toEqual([{ type: 'code', text: '$x$' }])
  })

  it('图片 ![alt](src) 切分为 image 记号（alt 可空，src 原样透传）', () => {
    expect(tokenizeInline('![截图](idb://noteimg/m-1/abc)')).toEqual([{ type: 'image', alt: '截图', src: 'idb://noteimg/m-1/abc' }])
    expect(tokenizeInline('![](idb://noteimg/m-1/abc)')).toEqual([{ type: 'image', alt: '', src: 'idb://noteimg/m-1/abc' }])
  })

  it('图片与文本/粗体混排按顺序切分', () => {
    expect(tokenizeInline('看这张 **重点** ![图](idb://noteimg/m/x) 之后')).toEqual([
      { type: 'text', text: '看这张 ' },
      { type: 'bold', text: '重点' },
      { type: 'text', text: ' ' },
      { type: 'image', alt: '图', src: 'idb://noteimg/m/x' },
      { type: 'text', text: ' 之后' },
    ])
  })

  it('alt 含 * 不被斜体截断（图片优先于 * 消费）', () => {
    expect(tokenizeInline('![a*b](idb://noteimg/m/x)')).toEqual([{ type: 'image', alt: 'a*b', src: 'idb://noteimg/m/x' }])
  })

  it('src 含空格/括号不匹配，保持纯文本', () => {
    expect(tokenizeInline('![a](some src)')).toEqual([{ type: 'text', text: '![a](some src)' }])
    expect(tokenizeInline('![a](x(y))')).toEqual([{ type: 'text', text: '![a](x(y))' }])
    // 前缀本身是合法引用、后面跟孤儿括号：图片记号 + 余文
    expect(tokenizeInline('![a](x)y)')).toEqual([
      { type: 'image', alt: 'a', src: 'x' },
      { type: 'text', text: 'y)' },
    ])
  })
})

describe('parseNoteMarkdown 块级解析', () => {
  it('空串返回空数组', () => {
    expect(parseNoteMarkdown('')).toEqual([])
    expect(parseNoteMarkdown('   \n  ')).toEqual([])
  })

  it('独立成行的图片落在段落里（单个 image 记号）', () => {
    expect(parseNoteMarkdown('![截图](idb://noteimg/m-1/abc)')).toEqual([
      { type: 'paragraph', inline: [{ type: 'image', alt: '截图', src: 'idb://noteimg/m-1/abc' }] },
    ])
  })

  it('空行分隔的多张图片各成段落', () => {
    expect(parseNoteMarkdown('![a](idb://noteimg/m/1)\n\n![b](idb://noteimg/m/2)')).toEqual([
      { type: 'paragraph', inline: [{ type: 'image', alt: 'a', src: 'idb://noteimg/m/1' }] },
      { type: 'paragraph', inline: [{ type: 'image', alt: 'b', src: 'idb://noteimg/m/2' }] },
    ])
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
      { type: 'list', items: [
        { inline: [{ type: 'text', text: 'a' }], children: [] },
        { inline: [{ type: 'bold', text: 'b' }], children: [] },
      ] },
      { type: 'list', items: [{ inline: [{ type: 'text', text: 'c' }], children: [] }] },
    ])
  })

  it('引用归并，引用与列表互相打断', () => {
    const blocks = parseNoteMarkdown('> 引用一\n> 引用二\n- 列表')
    expect(blocks).toEqual([
      { type: 'quote', lines: [[{ type: 'text', text: '引用一' }], [{ type: 'text', text: '引用二' }]] },
      { type: 'list', items: [{ inline: [{ type: 'text', text: '列表' }], children: [] }] },
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

  it('GFM 单短横分隔行 | - | - | 同样识别为分隔行（评审 #28）', () => {
    const blocks = parseNoteMarkdown('| A | B |\n| - | - |\n| x | y |')
    expect(blocks).toEqual([{
      type: 'table',
      header: [[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]],
      rows: [[[{ type: 'text', text: 'x' }], [{ type: 'text', text: 'y' }]]],
    }])
  })

  it('CRLF 与混合块顺序', () => {
    const blocks = parseNoteMarkdown('# T\r\n\r\n段落 *x*\r\n\r\n> q')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'quote'])
    expect(blocks[1]).toEqual({ type: 'paragraph', inline: [{ type: 'text', text: '段落 ' }, { type: 'italic', text: 'x' }] })
  })
})

describe('parseNoteMarkdown 嵌套列表', () => {
  const item = (text: string, children: NoteListItem[] = []): NoteListItem => ({ inline: [{ type: 'text', text }], children })

  it('缩进 2 空格一级、tab 折算 2 空格：同级互为兄弟，回退到顶是新顶层项', () => {
    const blocks = parseNoteMarkdown('- a\n  - b\n\t- c\n- d')
    expect(blocks).toEqual([{ type: 'list', items: [item('a', [item('b'), item('c')]), item('d')] }])
  })

  it('4 空格 = 两级：子项再嵌孙项', () => {
    expect(parseNoteMarkdown('- a\n  - b\n    - c')).toEqual([{ type: 'list', items: [item('a', [item('b', [item('c')])])] }])
  })

  it('跨级缺失收敛为栈顶直接子级；同缩进行互为兄弟（按测得层级比较）', () => {
    expect(parseNoteMarkdown('- a\n      - b\n      - c')).toEqual([{ type: 'list', items: [item('a', [item('b'), item('c')])] }])
  })

  it('子项后回退一级是父项的兄弟', () => {
    expect(parseNoteMarkdown('- a\n  - b\n  - c\n- d')).toEqual([{ type: 'list', items: [item('a', [item('b'), item('c')]), item('d')] }])
  })

  it('首项即缩进（无父可挂）视为顶层', () => {
    expect(parseNoteMarkdown('  - a\n  - b')).toEqual([{ type: 'list', items: [item('a'), item('b')] }])
  })

  it('空行结束整个列表（含子层），后接段落成两个块', () => {
    const blocks = parseNoteMarkdown('- a\n  - b\n\n段落')
    expect(blocks.map((b) => b.type)).toEqual(['list', 'paragraph'])
  })

  it('围栏代码块内的缩进 - 行是代码内容，不解析成列表', () => {
    expect(parseNoteMarkdown('```\n  - x\n```')).toEqual([{ type: 'code', text: '  - x' }])
  })

  it('嵌套项内容同样走行内记号', () => {
    expect(parseNoteMarkdown('- **a**\n  - `b`')).toEqual([{ type: 'list', items: [{
      inline: [{ type: 'bold', text: 'a' }],
      children: [{ inline: [{ type: 'code', text: 'b' }], children: [] }],
    }] }])
  })
})

describe('parseNoteMarkdown 公式块', () => {
  it('单行 $$..$$ 直接成公式块', () => {
    expect(parseNoteMarkdown('$$E=mc^2$$')).toEqual([{ type: 'math', text: 'E=mc^2' }])
  })

  it('多行 $$ 围栏（独立开闭行 / 首行带内容）', () => {
    expect(parseNoteMarkdown('$$\n\\frac{a}{b}\n$$')).toEqual([{ type: 'math', text: '\\frac{a}{b}' }])
    expect(parseNoteMarkdown('$$\\sum_{i=1}^n i\n$$')).toEqual([{ type: 'math', text: '\\sum_{i=1}^n i' }])
    expect(parseNoteMarkdown('$$\na +\n b\n$$')).toEqual([{ type: 'math', text: 'a +\n b' }])
  })

  it('未闭合也成块，与代码块一致', () => {
    expect(parseNoteMarkdown('$$\nabc')).toEqual([{ type: 'math', text: 'abc' }])
  })

  it('公式块打断列表/表格，前后块正常', () => {
    const blocks = parseNoteMarkdown('- a\n$$\nx\n$$\n| b | c |\n| --- | --- |\n| 1 | 2 |')
    expect(blocks.map((b) => b.type)).toEqual(['list', 'math', 'table'])
    expect(blocks[1]).toEqual({ type: 'math', text: 'x' })
  })

  it('一行多个 $$..$$ 落到段落，切成行内展示记号', () => {
    expect(parseNoteMarkdown('$$a$$ 和 $$b$$')).toEqual([{
      type: 'paragraph',
      inline: [
        { type: 'math', text: 'a', display: true },
        { type: 'text', text: ' 和 ' },
        { type: 'math', text: 'b', display: true },
      ],
    }])
  })

  it('公式块内的空行不打断', () => {
    expect(parseNoteMarkdown('$$\na\n\nb\n$$')).toEqual([{ type: 'math', text: 'a\n\nb' }])
  })

  it('围栏代码块内的 $ 原样保留', () => {
    expect(parseNoteMarkdown('```\n$E=mc^2$\n$$x$$\n```')).toEqual([{ type: 'code', text: '$E=mc^2$\n$$x$$' }])
  })

  it('表格单元格 / 列表项 / 标题内的行内公式', () => {
    const blocks = parseNoteMarkdown('| f | g |\n| --- | --- |\n| $x^2$ | y |')
    expect(blocks[0]).toEqual({
      type: 'table',
      header: [[{ type: 'text', text: 'f' }], [{ type: 'text', text: 'g' }]],
      rows: [[[{ type: 'math', text: 'x^2', display: false }], [{ type: 'text', text: 'y' }]]],
    })
    expect(parseNoteMarkdown('- $z$')[0]).toEqual({
      type: 'list',
      items: [{ inline: [{ type: 'math', text: 'z', display: false }], children: [] }],
    })
    expect(parseNoteMarkdown('## 能量 $E$')[0]).toEqual({
      type: 'heading',
      level: 2,
      inline: [{ type: 'text', text: '能量 ' }, { type: 'math', text: 'E', display: false }],
    })
  })
})

describe('parseNoteMarkdown 多余空行转 spacer', () => {
  it('连续 n≥2 空行 → lines = n-1 的 spacer 块', () => {
    expect(parseNoteMarkdown('a\n\n\nb')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
      { type: 'spacer', lines: 1 },
      { type: 'paragraph', inline: [{ type: 'text', text: 'b' }] },
    ])
    expect(parseNoteMarkdown('a\n\n\n\n\nb')[1]).toEqual({ type: 'spacer', lines: 3 })
  })

  it('单个空行不产生 spacer（保持标准块边界行为）', () => {
    expect(parseNoteMarkdown('a\n\nb')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
      { type: 'paragraph', inline: [{ type: 'text', text: 'b' }] },
    ])
  })

  it('首尾空行不产生 spacer', () => {
    expect(parseNoteMarkdown('\n\n\na\n\n\n')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
    ])
  })

  it('代码块 / 公式块内部的空行是内容，块前后多余空行转 spacer', () => {
    expect(parseNoteMarkdown('a\n\n\n```\nx\n\ny\n```\n\n\nb')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
      { type: 'spacer', lines: 1 },
      { type: 'code', text: 'x\n\ny' },
      { type: 'spacer', lines: 1 },
      { type: 'paragraph', inline: [{ type: 'text', text: 'b' }] },
    ])
    expect(parseNoteMarkdown('$$\na\n\nb\n$$')).toEqual([{ type: 'math', text: 'a\n\nb' }])
  })

  it('列表间的多余空行：先收块再插 spacer（顺序不颠倒）', () => {
    const blocks = parseNoteMarkdown('- a\n\n\n- b')
    expect(blocks.map((b) => b.type)).toEqual(['list', 'spacer', 'list'])
    expect(blocks[0]).toEqual({ type: 'list', items: [{ inline: [{ type: 'text', text: 'a' }], children: [] }] })
  })

  it('围栏代码紧跟列表（中间无空行）不误插 spacer', () => {
    const blocks = parseNoteMarkdown('- a\n```\nx\n```')
    expect(blocks.map((b) => b.type)).toEqual(['list', 'code'])
  })
})

describe('parseNoteMarkdown 分割线与居中容器', () => {
  it('--- / *** / ____ 均成分割线，-- 不足三条不成', () => {
    expect(parseNoteMarkdown('---')).toEqual([{ type: 'hr' }])
    expect(parseNoteMarkdown('***')).toEqual([{ type: 'hr' }])
    expect(parseNoteMarkdown('____')).toEqual([{ type: 'hr' }])
    expect(parseNoteMarkdown('--')).toEqual([{ type: 'paragraph', inline: [{ type: 'text', text: '--' }] }])
  })

  it('段落后的 --- 是分割线而非 setext 标题（有意不做 setext）；表格被正确收块', () => {
    expect(parseNoteMarkdown('段落\n---')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: '段落' }] },
      { type: 'hr' },
    ])
    expect(parseNoteMarkdown('| a | b |\n---').map((b) => b.type)).toEqual(['table', 'hr'])
  })

  it('分割线与多余空行 spacer 共存（顺序不颠倒）', () => {
    expect(parseNoteMarkdown('a\n\n\n---\nb')).toEqual([
      { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
      { type: 'spacer', lines: 1 },
      { type: 'hr' },
      { type: 'paragraph', inline: [{ type: 'text', text: 'b' }] },
    ])
  })

  it('::: center 容器：内部递归解析，::: 闭合', () => {
    expect(parseNoteMarkdown('::: center\n你好\n:::')).toEqual([{
      type: 'center',
      blocks: [{ type: 'paragraph', inline: [{ type: 'text', text: '你好' }] }],
    }])
    expect(parseNoteMarkdown(':::center\n**粗** 和 $x$\n:::')).toEqual([{
      type: 'center',
      blocks: [{ type: 'paragraph', inline: [{ type: 'bold', text: '粗' }, { type: 'text', text: ' 和 ' }, { type: 'math', text: 'x', display: false }] }],
    }])
  })

  it('居中容器内部可嵌空行/列表/代码块/公式块（一切行都是内容）', () => {
    expect(parseNoteMarkdown('::: center\na\n\n```\nc\n```\n- $x$\n:::')).toEqual([{
      type: 'center',
      blocks: [
        { type: 'paragraph', inline: [{ type: 'text', text: 'a' }] },
        { type: 'code', text: 'c' },
        { type: 'list', items: [{ inline: [{ type: 'math', text: 'x', display: false }], children: [] }] },
      ],
    }])
  })

  it('居中容器未闭合也成块，空容器产出空 blocks', () => {
    expect(parseNoteMarkdown('::: center\nabc')).toEqual([{
      type: 'center',
      blocks: [{ type: 'paragraph', inline: [{ type: 'text', text: 'abc' }] }],
    }])
    expect(parseNoteMarkdown('::: center\n\n:::')).toEqual([{ type: 'center', blocks: [] }])
  })

  it('::: 后跟其他词不是居中容器，保持段落', () => {
    expect(parseNoteMarkdown('::: note 提示')).toEqual([{
      type: 'paragraph',
      inline: [{ type: 'text', text: '::: note 提示' }],
    }])
  })
})

describe('enclosingCenter 取消居中定位', () => {
  // '前'\n\n'::: center'\n'A'\n'B'\n':::'\n\n'后'
  const doc = '前\n\n::: center\nA\nB\n:::\n\n后'
  // 区间：::: center [3,13) | A [14,15) | B [16,17) | ::: [18,21) | 后 [23,24)

  it('选区在容器内 → 返回四段区间（含内容 A\\nB）', () => {
    expect(enclosingCenter(doc, 14, 17)).toEqual({ from: 3, contentStart: 14, contentEnd: 17, to: 21 })
  })

  it('选区只选容器内一部分也命中（光标亦可）', () => {
    expect(enclosingCenter(doc, 16, 17)?.from).toBe(3)
    expect(enclosingCenter(doc, 14, 14)?.to).toBe(21)
  })

  it('容器前 / 容器后 → null', () => {
    expect(enclosingCenter(doc, 0, 1)).toBeNull()
    expect(enclosingCenter(doc, 23, 24)).toBeNull()
  })

  it('选区跨过闭合行（容器内 + 容器外）→ null', () => {
    expect(enclosingCenter(doc, 14, 19)).toBeNull()
  })

  it('未闭合容器延伸到文末（与解析器一致）', () => {
    const unclosed = '::: center\nabc'
    expect(enclosingCenter(unclosed, 11, 14)).toEqual({ from: 0, contentStart: 11, contentEnd: 14, to: 14 })
  })

  it('代码块内的字面 ::: center 不算容器（围栏奇偶防误判）', () => {
    const fenced = '```\n::: center\n```\nx'
    expect(enclosingCenter(fenced, 22, 23)).toBeNull()
  })

  it('代码块之后的真实容器正常命中', () => {
    // ``` [0,3) | c [4,5) | ``` [6,9) | 空行 | ::: center [11,21) | x [22,23) | ::: [24,27)
    const doc2 = '```\nc\n```\n\n::: center\nx\n:::'
    expect(enclosingCenter(doc2, 22, 23)?.from).toBe(11)
  })

  it('拆容器后内容与前后文无损拼接', () => {
    const enc = enclosingCenter(doc, 14, 17)!
    const next = doc.slice(0, enc.from) + doc.slice(enc.contentStart, enc.contentEnd) + doc.slice(enc.to)
    expect(next).toBe('前\n\nA\nB\n\n后')
  })
})
