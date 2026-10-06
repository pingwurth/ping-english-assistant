/**
 * HuggingFace 模型代理 — 磁盘缓存层
 *
 * 路径格式：/api/hf/{org}/{repo}/resolve/{revision}/{file}
 * 本地缓存：{modelPath}/{org}--{repo}/{file}
 *          modelPath 来自 ~/.ping-eng/settings.json 的 kokoro.modelPath
 *
 * GET  ：命中磁盘直接返回，未命中才从 huggingface.co 下载并写入磁盘。
 * HEAD ：只探测磁盘，不发起任何上游请求 —— 客户端据此区分「读缓存」还是「首次下载」。
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join, dirname } from 'path'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { readKokoroSettings } from '@/lib/server-settings'

const HF_BASE = 'https://huggingface.co'

/** 上游重试次数：HF 的 /resolve 会 302 到 CDN，偶发连不上，重试一次基本能过 */
const UPSTREAM_ATTEMPTS = 2

const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

interface HfFileRef {
  /** 磁盘缓存目录名：{org}--{repo} */
  cacheKey: string
  /** 缓存目录内的相对路径 */
  file: string
  /** 上游 URL */
  url: string
}

/** 解析 {org}/{repo}/resolve/{revision}/{file}，不合法时返回 null */
function parseHfPath(path: string[]): HfFileRef | null {
  const resolveIdx = path.indexOf('resolve')
  if (resolveIdx < 2 || resolveIdx >= path.length - 1) return null

  const org = path[0]
  const repo = path.slice(1, resolveIdx).join('/')
  const revision = path[resolveIdx + 1]
  const file = path.slice(resolveIdx + 2).join('/')
  if (!org || !repo || !revision || !file) return null

  return {
    cacheKey: `${org}--${repo}`,
    file,
    url: `${HF_BASE}/${org}/${repo}/resolve/${revision}/${file}`,
  }
}

/** 磁盘缓存中的绝对路径（目录不存在时按需创建） */
async function localFileOf(ref: HfFileRef): Promise<string> {
  const { modelPath } = await readKokoroSettings()
  return join(modelPath, ref.cacheKey, ref.file)
}

/** 探测磁盘缓存：只读本地文件，不会触发下载 */
export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const ref = parseHfPath((await params).path)
  if (!ref) return new NextResponse(null, { status: 400 })

  try {
    const info = await stat(await localFileOf(ref))
    return new NextResponse(null, {
      status: 200,
      headers: {
        'X-Cache': 'HIT',
        'X-File-Size': String(info.size),
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new NextResponse(null, {
      status: 404,
      headers: { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' },
    })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const ref = parseHfPath((await params).path)
  if (!ref) {
    return NextResponse.json({ error: 'Invalid HF path' }, { status: 400 })
  }

  const localFile = await localFileOf(ref)

  try {
    // 尝试从磁盘读取
    const data = await readFile(localFile)
    return new NextResponse(data, {
      headers: {
        'Content-Type': guessContentType(ref.file),
        'Content-Length': String(data.length),
        'X-Cache': 'HIT',
        // 浏览器侧不再留第二份副本，唯一缓存真源是磁盘
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    // 缓存未命中，从 HuggingFace 下载
  }

  try {
    const resp = await fetchUpstream(ref.url)
    if (resp.status !== 200) {
      return NextResponse.json(
        { error: `HuggingFace returned ${resp.status}` },
        { status: resp.status },
      )
    }

    const buffer = Buffer.from(await resp.arrayBuffer())

    // 挡住「不是模型数据」的响应：这类内容一旦落盘就会永久污染缓存
    const bad = detectBadPayload(buffer, resp.headers.get('content-length'), resp.headers.get('content-encoding'))
    if (bad) {
      return NextResponse.json({ error: bad }, { status: 502 })
    }

    // 写入磁盘缓存
    await mkdir(dirname(localFile), { recursive: true })
    await writeFile(localFile, buffer)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || guessContentType(ref.file),
        'Content-Length': String(buffer.length),
        'X-Cache': 'MISS',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch from HuggingFace: ${err}` },
      { status: 502 },
    )
  }
}

/**
 * 拉取上游文件。网络类失败（含 5xx / 未跟随的重定向）重试一次，
 * 4xx 是请求本身的问题，直接交给调用方按原状态返回。
 */
async function fetchUpstream(url: string): Promise<Awaited<ReturnType<typeof undiciFetch>>> {
  let lastErr: unknown = new Error('Upstream fetch failed')

  for (let attempt = 1; attempt <= UPSTREAM_ATTEMPTS; attempt++) {
    try {
      const resp = await undiciFetch(url, proxyAgent ? { dispatcher: proxyAgent } : {})
      if (resp.status === 200) return resp
      if (resp.status >= 400 && resp.status < 500) return resp
      lastErr = new Error(`HuggingFace returned ${resp.status}`)
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr
}

/**
 * 判断上游返回的到底是不是模型数据。
 * 这几种内容一旦写进磁盘缓存就会永久污染它，必须在落盘前拦下：
 *  - LFS 指针文件（真身在 CDN，/resolve 偶尔只漏出指针）
 *  - 重定向页 / 错误页（HTML）
 *  - 长度与声明的 content-length 不符（被截断）
 */
function detectBadPayload(
  buffer: Buffer,
  declaredLength: string | null,
  contentEncoding: string | null,
): string | null {
  // 上游若压缩过，content-length 是压缩后的大小，和实体长度对不上，跳过长度校验
  const encoding = contentEncoding?.toLowerCase()
  const declared = Number(declaredLength ?? 0)
  if (declared > 0 && (!encoding || encoding === 'identity') && buffer.length !== declared) {
    return `Payload size mismatch: got ${buffer.length} bytes, expected ${declared}`
  }

  const head = buffer.subarray(0, 128).toString('utf8').trimStart()
  if (head.startsWith('version https://git-lfs')) {
    return 'Upstream returned an LFS pointer instead of the file'
  }
  if (head.startsWith('<!DOCTYPE') || head.startsWith('<html')) {
    return 'Upstream returned an HTML page instead of the file'
  }
  return null
}

function guessContentType(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    json: 'application/json',
    bin: 'application/octet-stream',
    onnx: 'application/octet-stream',
    txt: 'text/plain',
    md: 'text/markdown',
    spiece: 'application/octet-stream',
  }
  return map[ext ?? ''] ?? 'application/octet-stream'
}