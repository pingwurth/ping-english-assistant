import { describe, expect, it } from 'vitest'
import { parseIflytekResultXml } from '../iflytek-xml'

/** 贴近真实形态：嵌套 syll/phone 需被忽略，content 含 XML 实体 */
const REALISTIC_XML = `<?xml version="1.0" encoding="utf-8"?>
<xml_result>
  <read_sentence xmlns="http://www.iflytek.com/2016/xml_format" ver="1.0">
    <rec_paper is_rejected="false" quality="2.0">
      <sentence content="hello it's me" total_score="4.3" accuracy_score="4.5" fluency_score="4.0" integrity_score="4.6" standard_score="4.4" begin_time="100" end_time="900" time_len="800">
        <word content="hello" total_score="4.8" dp_message="0" symbol="h@l@U">
          <syll symbol="h@l@U" start="100" end="400">
            <phone symbol="h" dp_message="0" start="100" end="150"/>
            <phone symbol="@U" dp_message="0" start="150" end="400"/>
          </syll>
        </word>
        <word content="it&#39;s" total_score="2.1" dp_message="16"/>
        <word content="me" total_score="4.0" dp_message="32"/>
      </sentence>
    </rec_paper>
  </read_sentence>
</xml_result>`

describe('parseIflytekResultXml', () => {
  it('解析句级 5 项分数与词级 content/total_score/dp_message，忽略嵌套 syll/phone', () => {
    const r = parseIflytekResultXml(REALISTIC_XML)
    expect(r.isRejected).toBe(false)
    expect(r.total).toBe(4.3)
    expect(r.accuracy).toBe(4.5)
    expect(r.fluency).toBe(4.0)
    expect(r.integrity).toBe(4.6)
    expect(r.standard).toBe(4.4)
    expect(r.words).toEqual([
      { text: 'hello', score: 4.8, dpMessage: 0 },
      { text: "it's", score: 2.1, dpMessage: 16 },
      { text: 'me', score: 4.0, dpMessage: 32 },
    ])
  })

  it('is_rejected="1" → isRejected true', () => {
    const r = parseIflytekResultXml('<xml_result><rec_paper is_rejected="1"><sentence/></rec_paper></xml_result>')
    expect(r.isRejected).toBe(true)
  })

  it('is_rejected="true" → isRejected true', () => {
    const r = parseIflytekResultXml('<xml_result><rec_paper is_rejected="true"><sentence/></rec_paper></xml_result>')
    expect(r.isRejected).toBe(true)
  })

  it('无 sentence/rec_paper 时返回安全默认', () => {
    const r = parseIflytekResultXml('<xml_result/>')
    expect(r).toEqual({ isRejected: false, words: [] })
  })
})
