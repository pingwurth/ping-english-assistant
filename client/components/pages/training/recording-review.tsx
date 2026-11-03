/**
 * 口语训练录音处理共享件 —— P7 影子跟读 / P8 全文背诵 复用，勿再各自实现
 * （真源：原型设计 §4.8 §4.9）。三个部分：
 *
 *  - transcribeRecording：录音转文字（契约①口径，本机 faster-whisper 优先、
 *    云端大模型兜底，均不可用时抛带启动指引的错误）；
 *  - useRecordingReplayUrl：录音回听 ObjectURL 生命周期（换新先 revoke 旧、卸载回收）；
 *  - RecordingReview：结果三卡（回放录音 / 录音转文字（失败可重试）/ 与原文逐词对比）。
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ApiError } from '@/services'
import { createRecorder, type WebRecorder } from '@/platform/recorder'
import type { DiffToken } from '@/core/training/dictation-diff'
import { callLlmTranscribe, callLocalTranscribe } from '@/components/shared/transcribe-shared'

/**
 * 录音转文字（契约①口径，走 BFF 转发）：本机 faster-whisper 优先
 * （/api/transcribe/local，未启动时返回 503），云端大模型兜底
 * （/api/transcribe，需在设置中配置转写模型）；两者均不可用时抛出
 * 带启动指引的错误。响应体一致：{ text, durationMs, segments }。
 */
export async function transcribeRecording(blob: Blob, signal?: AbortSignal): Promise<string> {
  const file = blob instanceof File ? blob : new File([blob], 'recording.wav', { type: blob.type || 'audio/wav' })
  const guardAbort = (err: unknown): void => {
    if ((err instanceof DOMException && err.name === 'AbortError') || signal?.aborted) {
      throw new ApiError('ABORTED', '操作已取消')
    }
  }
  try {
    return (await callLocalTranscribe(file, signal)).text.trim()
  } catch (err) {
    guardAbort(err)
  }
  try {
    return (await callLlmTranscribe(file, signal)).text.trim()
  } catch (err) {
    guardAbort(err)
    throw new Error('语音转写失败：请先启动本机转写服务（cd server && ./start.sh --server transcribe），或在设置中配置转写模型。')
  }
}

/**
 * 录音回听 ObjectURL（shadowing / read-aloud / recitation 同款回听）：
 * 换新/清空时先 revoke 旧 URL，组件卸载时回收，避免泄漏。
 */
export function useRecordingReplayUrl(): {
  recordingUrl: string | null
  setRecordingUrlFromBlob: (blob: Blob | null) => void
} {
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)
  const setRecordingUrlFromBlob = (blob: Blob | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = blob ? URL.createObjectURL(blob) : null
    setRecordingUrl(urlRef.current)
  }
  // 卸载时回收录音回听 ObjectURL
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])

  return { recordingUrl, setRecordingUrlFromBlob }
}

/**
 * 录音器会话 Hook —— P6 跟读 / P7 影子跟读 / P8 全文背诵 三页共用（原先三份拷贝
 * 已漂移：生命周期依赖、自动收尾接线各不相同）。挂载时创建 recorder，到达 60s 上限
 * （maxreach）回调 onMaxReach 做自动收尾；卸载时 destroy 并中止在途转写请求（abortRef）。
 * volume/计时高频更新由 LiveRecordingWave / LivePlayProgress 自订阅承接（评审 #51）。
 */
export function useRecorderSession(onMaxReach: () => void | Promise<void>): {
  recorder: WebRecorder | null
  recorderRef: RefObject<WebRecorder | null>
  abortRef: RefObject<AbortController | null>
} {
  const [recorder, setRecorder] = useState<WebRecorder | null>(null)
  const recorderRef = useRef<WebRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 每轮收尾闭包可能是新引用（页面 state 变化），经 ref 转发避免依赖它重建 recorder
  const onMaxReachRef = useRef(onMaxReach)
  onMaxReachRef.current = onMaxReach

  useEffect(() => {
    const rec = createRecorder()
    recorderRef.current = rec
    setRecorder(rec)
    rec.on('maxreach', () => { void onMaxReachRef.current() })
    const abort = new AbortController()
    abortRef.current = abort
    return () => {
      abort.abort()
      rec.destroy()
      recorderRef.current = null
      setRecorder(null)
    }
  }, [])

  return { recorder, recorderRef, abortRef }
}

/** 逐词对比着色：绿 = 读对；黑 = 原文（未标绿即漏读）；红括号 = 实际读出（跟在误读原文词后，单独出现为多读） */
function SpeechDiffTokens({ tokens }: { tokens: DiffToken[] }) {
  return (
    <p className="leading-loose">
      {tokens.map((t, i) => {
        if (t.type === 'correct') return <span key={i} className="font-medium text-green-600 dark:text-green-400">{t.text} </span>
        if (t.type === 'missing') return <span key={i}>{t.text} </span>
        if (t.type === 'wrong') return (
          <span key={i}>
            {t.text}
            <span className="font-medium text-destructive">（{t.input}）</span>{' '}
          </span>
        )
        return <span key={i} className="font-medium text-destructive">（{t.text}） </span>
      })}
    </p>
  )
}

/**
 * 录音结果三卡：回放录音 / 录音转文字（失败展示错误 + 重新转写）/ 与原文逐词对比。
 * 行动按钮（再练一次/返回训练中心等）由各训练页自持，不在此组件内。
 */
function RecordingReview({ recordingUrl, transcript, error, diffTokens, onRetry, playbackRef }: {
  recordingUrl: string | null
  transcript: string
  error: string | null
  diffTokens: DiffToken[]
  /** 用最近一次录音重新转写（不重新录音） */
  onRetry: () => void
  /** 回放 audio 元素引用（供新一轮开始前暂停上一轮回放） */
  playbackRef?: RefObject<HTMLAudioElement | null>
}) {
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">▶ 回放录音</p>
          {recordingUrl
            ? <audio ref={playbackRef} controls src={recordingUrl} preload="metadata" className="w-full" />
            : <p className="text-sm text-muted-foreground">未录到音频。</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">录音转文字</p>
          {error ? (
            <>
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="self-start" onClick={onRetry}>重新转写</Button>
            </>
          ) : transcript ? (
            <p className="text-sm leading-relaxed">{transcript}</p>
          ) : (
            <p className="text-sm text-muted-foreground">未识别到语音内容（可能录入了静音）。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">与原文对比</p>
          {diffTokens.length > 0 && <SpeechDiffTokens tokens={diffTokens} />}
          {transcript && diffTokens.every((t) => t.type === 'correct') && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">太棒了——逐词全部读对！</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span><span className="font-medium text-green-600 dark:text-green-400">绿字</span> = 读对</span>
            <span>黑字 = 原文 · 漏读</span>
            <span><span className="font-medium text-destructive">红括号</span> = 实际读出（跟在误读原文词后；单独出现为多读）</span>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

export { RecordingReview }
