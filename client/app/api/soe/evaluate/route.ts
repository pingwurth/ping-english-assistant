/**
 * SOE 评分 BFF 中转 — 读 settings.json 的 soe 配置，把所选 provider 的密钥以
 * multipart creds 字段注入后转发给 {proxyUrl}/api/v1/soe/evaluate。
 * 密钥不进浏览器请求、同源调用无 CORS；原样回传代理的状态码与 JSON。
 */
import { NextResponse } from 'next/server'
import { readSoeConfig, type SoeSettingsConfig } from '@/lib/server-settings'
import { isUnsafeUpstreamUrl, sameOriginGuard, unsafeUpstreamResponse } from '@/lib/api-guard'
import { MAX_SOE_UPLOAD_BYTES, rejectOversizedBlob, rejectOversizedUpload } from '@/lib/upload-limit'
import { SOE_EVALUATE_ENDPOINT, buildServiceUrl } from '@/lib/service-endpoints'
import { withUpstreamTimeout } from '@/lib/bff-upstream'

/** 代理调用硬超时：句子级评分（≤60s 音频）给足余量，对齐 translate/mnemonic 的 120s */
const SOE_EVALUATE_TIMEOUT_MS = 120_000

/** 取所选 provider 的密钥（剥离空串）；未配置 → null（省略 creds 字段，代理回落 env） */
function buildCreds(cfg: SoeSettingsConfig): Record<string, Record<string, string>> | null {
  const section = cfg[cfg.provider as 'azure' | 'tencent' | 'iflytek'] as Record<string, string> | undefined
  if (!section) return null
  const clean = Object.fromEntries(Object.entries(section).filter(([, v]) => typeof v === 'string' && v !== ''))
  return Object.keys(clean).length > 0 ? { [cfg.provider]: clean } : null
}

export async function POST(req: Request) {
  // 同源守卫（评审 #2）：本路由会把所选中 provider 的真实密钥转发给评分代理
  const denied = sameOriginGuard(req)
  if (denied) return denied
  // formData() 会把整个 multipart 缓冲进内存：按声明体积提前拒绝（c055）
  const oversized = rejectOversizedUpload(req, MAX_SOE_UPLOAD_BYTES)
  if (oversized) return oversized

  const cfg = await readSoeConfig()
  // proxyUrl 同样是用户可控的服务端出网目标（c090：SSRF 门此前只管 LLM baseUrl）
  if (cfg && isUnsafeUpstreamUrl(cfg.proxyUrl)) return unsafeUpstreamResponse()
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
  // 真实字节二次闸：chunked 上传不带 Content-Length 可绕过声明预检（c031）——
  // 缺这道闸时超大 body 已被 formData() 全量缓冲，才被远端代理的 25MB 拒绝
  const oversizedBlob = rejectOversizedBlob(audio, MAX_SOE_UPLOAD_BYTES)
  if (oversizedBlob) return oversizedBlob
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

  // 客户端取消 + 路由层硬超时（c022）：此前只传 req.signal —— 代理黑洞时评分 spinner
  // 悬挂分钟级（undici 默认 ~300s）且无取消入口；兄弟路由全部有显式超时与 504。
  // fetch 与 text() 必须同处一个超时窗口（quick 复审 c001）：done() 挂在 fetch 的
  // finally 会让响应头一到就清掉定时器，代理「发完头停发体」时读体无界悬挂。
  const upstreamTimeout = withUpstreamTimeout(req.signal, SOE_EVALUATE_TIMEOUT_MS)
  let upstream: Response | null = null
  let text: string
  try {
    // 代理开启共享密钥鉴权（server/.env SOE_SHARED_TOKEN）时补 x-soe-token 头；
    // 此前 BFF 从不携带 → 跨机部署下每次评分 401，而 healthz 不鉴权使连接徽标仍绿
    const headers: Record<string, string> = cfg.sharedToken ? { 'x-soe-token': cfg.sharedToken } : {}
    upstream = await fetch(buildServiceUrl(cfg.proxyUrl, SOE_EVALUATE_ENDPOINT), {
      method: 'POST',
      body: outgoing,
      headers,
      signal: upstreamTimeout.signal,
    })
    // 状态码与 JSON 原样透传（错误信封 { code, message, detail? } 语义由代理侧保证）。
    // 读体也在超时窗口与 try 内：断连/中止不能变成 Next 通用 500（c028）
    text = await upstream.text()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // SOE 族错误信封是 {code, message, detail?}（客户端 ApiSoeService 按此解析，
      // quick 复审 c015）：不复用通用 {error, code} 形状的 upstreamAbortResponse。
      // 取消(客户端已断开)→499 空体；硬超时→504 + 超时信封
      if (req.signal.aborted) return new NextResponse(null, { status: 499 })
      return NextResponse.json(
        { code: 'SOE_TIMEOUT', message: '评分请求超时，请稍后重试' },
        { status: 504 },
      )
    }
    return NextResponse.json(
      upstream
        ? { code: 'SOE_UPSTREAM_ERROR', message: `评分代理响应中断（${upstream.status}）` }
        : { code: 'SOE_UPSTREAM_ERROR', message: '评分代理不可达，请检查模型设置中的代理地址' },
      { status: 502 },
    )
  } finally {
    upstreamTimeout.done()
  }
  return new Response(text, { status: upstream.status, headers: { 'content-type': 'application/json' } })
}
