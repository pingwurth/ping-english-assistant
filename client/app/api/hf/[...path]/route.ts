/**
 * HuggingFace 模型代理 — 磁盘缓存层
 *
 * 路径格式：/api/hf/{org}/{repo}/resolve/{revision}/{file}
 * 本地缓存：{modelPath}/{org}--{repo}/{file}
 *          modelPath 来自 ~/.ping-eng/settings.json 的 kokoro.modelPath
 *
 * GET ：命中磁盘直接返回，未命中才从上游下载并写入磁盘。
 * HEAD：只探测磁盘，不发起任何上游请求 —— 客户端据此区分「读缓存」还是「首次下载」。
 *
 * 安全：路径段会直接成为磁盘路径原料，任何 `..`、`.`、编码斜杠（%2f/%2e）一律拒绝；
 *       localFileOf 再做一次 resolve 前缀校验（纵深防御）。
 * 缓存：下载经 tmp+rename 原子落盘，sidecar `.meta` 记录 size，命中时校验 ——
 *       截断文件自动判 MISS 重新下载，不会永久污染；同文件并发未命中共享一次下载。
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir, stat, rename } from 'fs/promises'
import { join, dirname, resolve, sep } from 'path'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { readKokoroSettings } from '@/lib/server-settings'
import { DEFAULT_HF_BASE } from '@/lib/service-endpoints'
import { isAllowedKokoroFile } from '@/platform/kokoro-protocol'
import { parseHfPath, type HfFileRef } from '@/platform/hf-path'

/** 上游地址：默认 huggingface.co，可用 HF_BASE 环境变量覆盖（如 hf-mirror.com） */
const HF_BASE = process.env.HF_BASE || DEFAULT_HF_BASE

/** 上游重试次数：HF 的 /resolve 会 302 到 CDN，偶发连不上，重试一次基本能过 */
const UPSTREAM_ATTEMPTS = 2
/** q8 Kokoro 模型约 89MB；保留余量并阻止把代理当作任意大文件下载器。 */
const MAX_HF_FILE_BYTES = 128 * 1024 * 1024

const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

/**
 * 解析磁盘缓存绝对路径。除路径 containment 外，还只接受：
 * settings.kokoro.modelId、main revision、Kokoro 实际会加载的文件。
 * 这样该代理不能被当作任意 HuggingFace 仓库/任意大文件的下载器。
 */
async function localFileOf(ref: HfFileRef): Promise<string | null> {
  const { modelId: configuredModelId, modelPath } = await readKokoroSettings()
  if (configuredModelId.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return null
  if (ref.modelId !== configuredModelId) return null
  if (!isAllowedKokoroFile(ref.file)) return null

  const cacheRoot = resolve(modelPath)
  const localFile = resolve(join(cacheRoot, ref.cacheKey, ref.file))
  if (localFile !== cacheRoot && !localFile.startsWith(cacheRoot + sep)) {
    return null
  }
  return localFile
}

/** 读取下载时存的 sidecar（size/etag）；无 sidecar（旧版缓存）返回 null = 信任现有文件 */
async function readCacheMeta(localFile: string): Promise<{ size: number } | null> {
  try {
    const meta = JSON.parse(await readFile(`${localFile}.meta`, 'utf-8')) as { size?: unknown }
    return typeof meta.size === 'number' ? { size: meta.size } : null
  } catch {
    return null
  }
}

/** 命中前提：文件存在，且（若有 sidecar）大小与落盘时一致；否则视为 MISS */
async function readCached(localFile: string): Promise<Buffer | null> {
  try {
    const [data, meta] = await Promise.all([readFile(localFile), readCacheMeta(localFile)])
    if (meta && data.length !== meta.size) {
      console.warn(
        `[hf] cache size mismatch for ${localFile} (${data.length} != ${meta.size}), re-downloading`,
      )
      return null
    }
    return data
  } catch {
    return null
  }
}

/** HEAD 用轻量探测：stat + sidecar 校验，不读整个文件 */
async function cacheStat(localFile: string): Promise<number | null> {
  try {
    const [info, meta] = await Promise.all([stat(localFile), readCacheMeta(localFile)])
    if (meta && info.size !== meta.size) return null
    return info.size
  } catch {
    return null
  }
}

/** 同文件并发未命中时共享的下载任务（in-flight 去重） */
const inflightDownloads = new Map<string, Promise<Buffer>>()

/** 下载 + 原子落盘（tmp+rename），并写 size sidecar 供命中校验 */
async function downloadAndCache(ref: HfFileRef, localFile: string): Promise<Buffer> {
  const resp = await fetchUpstream(ref.url)
  if (resp.status !== 200) {
    const err = new Error(`HuggingFace returned ${resp.status}`) as Error & { status?: number }
    err.status = resp.status
    throw err
  }

  const declaredLength = Number(resp.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_HF_FILE_BYTES) {
    throw new Error(`HF file exceeds ${MAX_HF_FILE_BYTES} bytes: ${ref.file}`)
  }

  // arrayBuffer 前先检查声明长度；chunked/压缩响应仍以下载后的实际长度兜底。
  const buffer = Buffer.from(await resp.arrayBuffer())
  if (buffer.length > MAX_HF_FILE_BYTES) {
    throw new Error(`HF file exceeds ${MAX_HF_FILE_BYTES} bytes: ${ref.file}`)
  }

  // 挡住「不是模型数据」的响应：这类内容一旦落盘就会永久污染缓存
  const bad = detectBadPayload(buffer, resp.headers.get('content-length'), resp.headers.get('content-encoding'))
  if (bad) throw new Error(bad)

  await mkdir(dirname(localFile), { recursive: true })
  const tmp = `${localFile}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, buffer)
  await rename(tmp, localFile)

  const metaTmp = `${localFile}.meta.tmp-${process.pid}-${Date.now()}`
  await writeFile(metaTmp, JSON.stringify({ size: buffer.length }), 'utf-8')
  await rename(metaTmp, `${localFile}.meta`)

  return buffer
}

function downloadShared(ref: HfFileRef, localFile: string): Promise<Buffer> {
  const existing = inflightDownloads.get(localFile)
  if (existing) return existing
  const task = downloadAndCache(ref, localFile)
  inflightDownloads.set(localFile, task)
  task
    .finally(() => inflightDownloads.delete(localFile))
    .catch(() => { /* 下载失败由各 await 方自行处理 */ })
  return task
}

/** 探测磁盘缓存：只读本地文件，不会触发下载 */
export async function HEAD(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const ref = parseHfPath((await params).path, HF_BASE)
  if (!ref) return new NextResponse(null, { status: 400 })

  try {
    const localFile = await localFileOf(ref)
    if (localFile === null) return new NextResponse(null, { status: 403 })
    const size = await cacheStat(localFile)
    if (size === null) {
      return new NextResponse(null, {
        status: 404,
        headers: { 'X-Cache': 'MISS', 'Cache-Control': 'no-store' },
      })
    }
    return new NextResponse(null, {
      status: 200,
      headers: {
        'X-Cache': 'HIT',
        'X-File-Size': String(size),
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new NextResponse(null, { status: 400 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const ref = parseHfPath((await params).path, HF_BASE)
  if (!ref) {
    return NextResponse.json({ error: 'Invalid HF path' }, { status: 400 })
  }

  let localFile: string | null
  try {
    localFile = await localFileOf(ref)
  } catch {
    return NextResponse.json({ error: 'Invalid HF path' }, { status: 400 })
  }
  if (localFile === null) {
    return NextResponse.json({ error: 'HF file is outside the configured Kokoro model' }, { status: 403 })
  }

  const cached = await readCached(localFile)
  if (cached) {
    return new NextResponse(cached, {
      headers: {
        'Content-Type': guessContentType(ref.file),
        'Content-Length': String(cached.length),
        'X-Cache': 'HIT',
        // 浏览器侧不再留第二份副本，唯一缓存真源是磁盘
        'Cache-Control': 'no-store',
      },
    })
  }

  try {
    const buffer = await downloadShared(ref, localFile)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': guessContentType(ref.file),
        'Content-Length': String(buffer.length),
        'X-Cache': 'MISS',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: `HuggingFace returned ${status}` }, { status })
    }
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
