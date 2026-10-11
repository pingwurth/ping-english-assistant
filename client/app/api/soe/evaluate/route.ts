/**
 * SOE 评分 BFF 中转 — 读 settings.json 的 soe 配置，把所选 provider 的密钥以
 * multipart creds 字段注入后转发给 {proxyUrl}/api/v1/soe/evaluate。
 * 密钥不进浏览器请求、同源调用无 CORS；原样回传代理的状态码与 JSON。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig, type SoeSettingsConfig } from '@/lib/server-settings'
import { buildServiceUrl } from '@/lib/service-endpoints'

/** 取所选 provider 的密钥（剥离空串）；未配置 → null（省略 creds 字段，代理回落 env） */
function buildCreds(cfg: SoeSettingsConfig): Record<string, Record<string, string>> | null {
  const section = cfg[cfg.provider as 'azure' | 'tencent' | 'iflytek'] as Record<string, string> | undefined
  if (!section) return null
  const clean = Object.fromEntries(Object.entries(section).filter(([, v]) => typeof v === 'string' && v !== ''))
  return Object.keys(clean).length > 0 ? { [cfg.provider]: clean } : null
}

export async function POST(req: Request) {
  const cfg = await readSoeConfig()
  if (!cfg || cfg.provider === 'mock') {
    return NextResponse.json({ code: 'BAD_REQUEST', message: '演示模式无需代理评分' }, { status: 400 })
  }

  let incoming: FormData
  try {
    incoming = await req.formData()
  } catch {
    return NextResponse.json({ code: 'BAD_REQUEST', message: '请求必须是 multipart/form-data' }, { status: 400 })
  }

  const audio = incoming.get('audio')
  const refText = incoming.get('refText')
  const evalMode = incoming.get('evalMode')
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: '缺少 multipart 音频文件字段 audio' }, { status: 400 })
  }
  if (typeof refText !== 'string' || !refText.trim()) {
    return NextResponse.json({ code: 'BAD_REQUEST', message: '缺少参考原文 refText' }, { status: 400 })
  }

  // 文本字段置于 audio 之前（@fastify/multipart 的 req.file() 按文档只保证文件之前的字段可见）
  const outgoing = new FormData()
  outgoing.append('refText', refText)
  outgoing.append('evalMode', typeof evalMode === 'string' && evalMode ? evalMode : 'sentence')
  outgoing.append('provider', cfg.provider)
  const creds = buildCreds(cfg)
  if (creds) outgoing.append('creds', JSON.stringify(creds))
  outgoing.append('audio', audio, 'audio.wav')

  let upstream: Response
  try {
    upstream = await fetch(buildServiceUrl(cfg.proxyUrl, '/api/v1/soe/evaluate'), {
      method: 'POST',
      body: outgoing,
      signal: req.signal,
    })
  } catch {
    return NextResponse.json(
      { code: 'SOE_UPSTREAM_ERROR', message: '评分代理不可达，请检查模型设置中的代理地址' },
      { status: 502 },
    )
  }

  // 状态码与 JSON 原样透传（错误信封 { code, message, detail? } 语义由代理侧保证）
  const text = await upstream.text()
  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } })
}
