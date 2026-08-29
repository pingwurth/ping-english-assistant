/**
 * HuggingFace 模型代理 — 磁盘缓存层
 *
 * 路径格式：/api/hf/{org}/{repo}/resolve/{revision}/{file}
 * 本地缓存：~/.ping-eng/kokoro-models/{org}--{repo}/{file}
 *
 * 首次请求从 huggingface.co 下载并写入磁盘，后续直接从磁盘读取。
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const HF_BASE = 'https://huggingface.co'
const CACHE_DIR = join(homedir(), '.ping-eng', 'kokoro-models')

const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params
  const filePath = path.join('/')

  // 解析：{org}/{repo}/resolve/{revision}/{file}
  // 例：onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/config.json
  const resolveIdx = path.indexOf('resolve')
  if (resolveIdx < 2 || resolveIdx >= path.length - 1) {
    return NextResponse.json({ error: 'Invalid HF path' }, { status: 400 })
  }

  const org = path[0]!
  const repo = path.slice(1, resolveIdx).join('/')
  const revision = path[resolveIdx + 1]!
  const file = path.slice(resolveIdx + 2).join('/')

  if (!file) {
    return NextResponse.json({ error: 'Missing file path' }, { status: 400 })
  }

  // 本地缓存路径：{org}--{repo}/{file}
  const localDir = join(CACHE_DIR, `${org}--${repo}`)
  const localFile = join(localDir, file)

  try {
    // 尝试从磁盘读取
    const data = await readFile(localFile)
    return new NextResponse(data, {
      headers: {
        'Content-Type': guessContentType(file),
        'Content-Length': String(data.length),
        'X-Cache': 'HIT',
      },
    })
  } catch {
    // 缓存未命中，从 HuggingFace 下载
  }

  const remoteUrl = `${HF_BASE}/${org}/${repo}/resolve/${revision}/${file}`

  try {
    const resp = await undiciFetch(remoteUrl, proxyAgent ? { dispatcher: proxyAgent } : {})
    if (!resp.ok) {
      return NextResponse.json(
        { error: `HuggingFace returned ${resp.status}` },
        { status: resp.status },
      )
    }

    const buffer = Buffer.from(await resp.arrayBuffer())

    // 写入磁盘缓存
    await mkdir(dirname(localFile), { recursive: true })
    await writeFile(localFile, buffer)

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || guessContentType(file),
        'Content-Length': String(buffer.length),
        'X-Cache': 'MISS',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch from HuggingFace: ${err}` },
      { status: 502 },
    )
  }
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
