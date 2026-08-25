import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Brain, Cpu, ExternalLink, FileAudio, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Shell, PageIntro } from '@/components/shared/shell'
import { getServices, ApiError, toApiError } from '@/services'
import type { AsrTranscribeSegment } from '@/types/api'

/* ── SRT 工具 ── */

function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1_000)
  const msRemainder = ms % 1_000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msRemainder).padStart(3, '0')}`
}

function segmentsToSrt(segments: AsrTranscribeSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${seg.text}`)
    .join('\n\n')
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/* ── 页面 ── */

type Method = 'local' | 'model' | 'third-party'
type Status = 'idle' | 'running' | 'done' | 'error'

const methodData: { id: Method; icon: typeof Cpu; title: string; desc: string; meta: string }[] = [
  { id: 'local', icon: Cpu, title: 'faster-whisper', desc: '本机 GPU 推理，隐私优先', meta: '推荐 · 支持 CUDA' },
  { id: 'model', icon: Brain, title: '调用大模型', desc: '云端高精度识别与智能断句', meta: '需要 AI Gateway' },
  { id: 'third-party', icon: ExternalLink, title: '第三方工具', desc: '跳转通义听悟、飞书妙记处理', meta: '适合长音频' },
]

export function TranscribePage() {
  const [method, setMethod] = useState<Method>('local')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState('')
  const [srt, setSrt] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async () => {
    if (!file) return

    // 第三方跳转不走 ASR 服务
    if (method === 'third-party') return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    setError('')
    setEditing(false)

    try {
      const audio = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/wav' })
      const res = await getServices().asr.transcribe(audio, 'en', ctrl.signal)
      const srtText = segmentsToSrt(res.segments)
      setResult(res.text)
      setSrt(srtText)
      setStatus('done')
    } catch (err) {
      const apiErr = toApiError(err)
      if (apiErr.code === 'ABORTED') return // 用户取消，不切状态
      setError(apiErr.message)
      setStatus('error')
    }
  }, [file, method])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
  }, [])

  const handleDownloadSrt = useCallback(() => {
    if (!srt) return
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const name = file?.name.replace(/\.[^.]+$/, '') || 'subtitle'
    downloadBlob(blob, `${name}.srt`)
  }, [srt, file])

  const handleSrtChange = useCallback((value: string) => {
    setSrt(value)
  }, [])

  return (
    <Shell back>
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <PageIntro title="音频转文字" eyebrow="AUDIO TRANSCRIPTION">
          <Badge variant="secondary">生成双语字幕</Badge>
        </PageIntro>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* 左栏：上传 + 方式选择 */}
          <Card>
            <CardHeader>
              <CardTitle>1. 上传音频</CardTitle>
              <CardDescription>支持 mp3、wav、m4a、mp4，建议单个文件小于 500 MB</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-muted/40 p-6 text-center transition-colors hover:border-primary">
                <Upload className="text-primary" />
                <span className="font-medium">{file ? file.name : '点击选择音频或拖拽到这里'}</span>
                <span className="text-sm text-muted-foreground">本地文件不会自动上传</span>
                <Input
                  type="file"
                  accept="audio/*,video/*"
                  className="sr-only"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </label>

              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">2. 选择转换方式</p>
                {methodData.map(item => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => setMethod(item.id)}
                      className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                        method === item.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon />
                      </span>
                      <span className="flex-1">
                        <span className="block font-medium">{item.title}</span>
                        <span className="block text-sm text-muted-foreground">{item.desc}</span>
                      </span>
                      <Badge variant={method === item.id ? 'default' : 'outline'}>{item.meta}</Badge>
                    </button>
                  )
                })}
              </div>

              {method === 'local' && (
                <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">本机环境检查</p>
                  <p className="mt-1">将使用 faster-whisper large-v3 · CUDA · 中文/英文自动识别</p>
                </div>
              )}
              {method === 'model' && (
                <div className="rounded-xl bg-primary/10 p-4 text-sm text-primary">
                  <p className="font-medium">大模型转写设置</p>
                  <p className="mt-1">自动识别语言、断句并生成时间轴字幕。音频会发送到云端模型处理。</p>
                </div>
              )}
              {method === 'third-party' && (
                <div className="flex flex-wrap gap-2 rounded-xl bg-muted p-4">
                  <a
                    href="https://tingwu.aliyun.com/"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    打开通义听悟 <ExternalLink data-icon="inline-end" />
                  </a>
                  <a
                    href="https://www.feishu.cn/product/minutes"
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    打开飞书妙记 <ExternalLink data-icon="inline-end" />
                  </a>
                </div>
              )}

              {status === 'running' ? (
                <Button className="w-full" variant="destructive" onClick={cancel}>
                  取消转换
                </Button>
              ) : (
                <Button
                  className="w-full"
                  disabled={!file || method === 'third-party'}
                  onClick={start}
                >
                  {status === 'error' ? '重新转换' : '开始转换'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* 右栏：结果 */}
          <Card>
            <CardHeader>
              <CardTitle>转换结果</CardTitle>
              <CardDescription>
                {status === 'idle'
                  ? '转换完成后将在这里预览字幕'
                  : status === 'running'
                    ? '正在分析音频并生成时间轴…'
                    : status === 'error'
                      ? '转换失败'
                      : editing
                        ? '编辑完成后可保存为 .srt 文件'
                        : '已生成字幕，可继续编辑'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-80 flex-col gap-4">
              {status === 'idle' && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  <FileAudio className="text-primary" />
                  <p>选择音频并开始转换</p>
                </div>
              )}

              {status === 'running' && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                  <div className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                  <p className="text-sm text-muted-foreground">
                    {method === 'local' ? 'faster-whisper 正在本机 GPU 推理' : '大模型正在生成字幕'}
                  </p>
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  <p className="text-sm text-destructive">{error || '转换过程中出现错误'}</p>
                  <Button variant="outline" onClick={start}>
                    重试
                  </Button>
                </div>
              )}

              {status === 'done' && (
                <>
                  {editing ? (
                    <Textarea
                      value={srt}
                      onChange={e => handleSrtChange(e.target.value)}
                      className="min-h-48 font-mono text-sm"
                    />
                  ) : (
                    <pre className="min-h-48 whitespace-pre-wrap rounded-xl bg-muted p-4 font-sans text-sm leading-7">
                      {result}
                    </pre>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={handleDownloadSrt}>
                      下载 .srt
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(!editing)}>
                      {editing ? '完成编辑' : '编辑字幕'}
                    </Button>
                    <Link to="/import">
                      <Button>导入为学习材料</Button>
                    </Link>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Shell>
  )
}
