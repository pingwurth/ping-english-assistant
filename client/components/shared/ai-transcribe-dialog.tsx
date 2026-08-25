import { useCallback, useRef, useState } from 'react'
import { Brain, Cpu, ExternalLink, FileAudio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent } from '@/components/ui/dialog'
import { getServices, toApiError } from '@/services'
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

/* ── 类型 ── */

type Method = 'local' | 'model' | 'third-party'
type Status = 'idle' | 'running' | 'done' | 'error'

const methodData: { id: Method; icon: typeof Cpu; title: string; desc: string; meta: string }[] = [
  { id: 'third-party', icon: ExternalLink, title: '第三方工具', desc: '跳转通义听悟、飞书妙记、讯飞听见处理', meta: '适合长音频' },
  { id: 'model', icon: Brain, title: '调用大模型', desc: '云端高精度识别与智能断句', meta: '需要 API Key' },
  { id: 'local', icon: Cpu, title: 'faster-whisper', desc: '本机 GPU 推理，隐私优先', meta: '推荐 · 支持 CUDA' },
]

/* ── 组件 ── */

interface AiTranscribeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mediaFile: File | null
  onSubtitleGenerated: (srtText: string) => void
}

export function AiTranscribeDialog({ open, onOpenChange, mediaFile, onSubtitleGenerated }: AiTranscribeDialogProps) {
  const [method, setMethod] = useState<Method>('third-party')
  const [status, setStatus] = useState<Status>('idle')
  const [result, setResult] = useState('')
  const [srt, setSrt] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async () => {
    if (!mediaFile) return

    // 第三方跳转不走 ASR 服务
    if (method === 'third-party') return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    setError('')
    setEditing(false)

    try {
      const audio = new Blob([await mediaFile.arrayBuffer()], { type: mediaFile.type || 'audio/wav' })
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
  }, [mediaFile, method])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
  }, [])

  const handleSrtChange = useCallback((value: string) => {
    setSrt(value)
  }, [])

  const handleImport = useCallback(() => {
    if (!srt) return
    onSubtitleGenerated(srt)
    onOpenChange(false)
    // 重置状态
    setStatus('idle')
    setResult('')
    setSrt('')
    setError('')
  }, [srt, onSubtitleGenerated, onOpenChange])

  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      cancel()
    }
    onOpenChange(open)
  }, [onOpenChange, cancel])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogHeader>
        <DialogTitle>AI 音频转字幕</DialogTitle>
        <DialogDescription>
          {mediaFile
            ? `使用 ${mediaFile.name} 生成字幕`
            : '当前材料没有媒体文件，无法生成字幕'}
        </DialogDescription>
      </DialogHeader>

      <DialogContent>
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* 左栏：方式选择 */}
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">选择转换方式</p>
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
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  打开通义听悟 <ExternalLink data-icon="inline-end" />
                </a>
                <a
                  href="https://www.feishu.cn/product/minutes"
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  打开飞书妙记 <ExternalLink data-icon="inline-end" />
                </a>
                <a
                  href="https://www.iflyrec.com/home"
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  打开讯飞听见 <ExternalLink data-icon="inline-end" />
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
                disabled={!mediaFile || method === 'third-party'}
                onClick={start}
              >
                {status === 'error' ? '重新转换' : '开始转换'}
              </Button>
            )}
          </div>

          {/* 右栏：结果 */}
          <div className="flex min-h-60 flex-col gap-4">
            <p className="text-sm font-medium">
              {status === 'idle'
                ? '转换结果'
                : status === 'running'
                  ? '正在分析音频并生成时间轴…'
                  : status === 'error'
                    ? '转换失败'
                    : editing
                      ? '编辑完成后可导入'
                      : '已生成字幕，可继续编辑'}
            </p>

            {status === 'idle' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                <FileAudio className="text-primary" />
                <p>选择转换方式并开始</p>
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
                  <Button variant="outline" onClick={() => setEditing(!editing)}>
                    {editing ? '完成编辑' : '编辑字幕'}
                  </Button>
                  <Button onClick={handleImport}>
                    导入字幕
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
