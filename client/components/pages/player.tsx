import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Sparkles, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell, pauseAllMedia } from '@/components/shared/shell'
import { formatDuration, PlayerControlBar, SubtitleList } from '@/components/shared/player-parts'
import { BackgroundCarousel } from '@/components/shared/background-carousel'
import { AiTranscribeDialog } from '@/components/shared/ai-transcribe-dialog'
import { SubtitleEditDialog } from '@/components/shared/subtitle-edit-dialog'
import { getMaterialRecord, getMediaBlob, getProgress, putMaterialRecord, touchMaterial } from '@/stores/material-store'
import { recordsStore } from '@/platform/storage/idb'
import { RECORD_KEYS, type MaterialRecord } from '@/platform/storage/schema'
import { HtmlPlayerController } from '@/platform/html-player'
import { SentencePlayer } from '@/core/player/sentence-player'
import { getDefaultLoop, getDefaultRate } from '@/lib/pref-keys'
import { exportSrt, parseSubtitle } from '@/core/subtitle'
import type { Favorite, LearningProgress } from '@/types/progress'
import type { SubtitleMode, SubtitleSentence } from '@/types/subtitle'

/** 倍速循环序列（原型阶段三档） */
const RATES = [0.75, 1, 1.25]
/** 学习进度写入节流：5s（播放过的句子增量持久化） */
const PROGRESS_FLUSH_MS = 5000
/** 背景图片列表（非视频内容时自动轮播） */
const BACKGROUND_IMAGES = [
  '/background/1.png',
  '/background/2.png',
  '/background/3.png',
  '/background/4.png',
  '/background/5.png',
  '/background/6.png',
  '/background/7.png',
  '/background/8.png',
  '/background/9.png',
  '/background/10.png',
  '/background/11.png',
  '/background/12.png',
  '/background/13.png',
  '/background/14.png',
  '/background/15.png',
  '/background/16.png',
  '/background/17.png',
  '/background/18.png',
  '/background/19.png',
  '/background/20.png',
  '/background/21.png',
  '/background/22.png',
  '/background/23.png',
  '/background/24.png',
  '/background/25.png',
  '/background/26.png',
]

/**
 * Fisher-Yates 洗牌算法：随机打乱数组顺序
 * @param array 要打乱的数组
 * @returns 打乱后的新数组（不修改原数组）
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function Player() {
  const { materialId = '' } = useParams()
  const navigate = useNavigate()
  const [record, setRecord] = useState<MaterialRecord | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showAiDialog, setShowAiDialog] = useState(false)
  const [editingSentence, setEditingSentence] = useState<{ index: number; sentence: SubtitleSentence } | null>(null)
  const [mode, setMode] = useState<SubtitleMode>('bilingual')
  // 默认循环次数/倍速读自 P10 设置（prefs；'inf' → Infinity；SSR 安全：getPref 内置降级）
  const [loop, setLoop] = useState(() => { const l = getDefaultLoop(); return l === 'inf' ? Number.POSITIVE_INFINITY : l })
  const [rate, setRate] = useState<number>(() => getDefaultRate())
  const [active, setActive] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [volume, setVolumeState] = useState(1)
  const [favSet, setFavSet] = useState<Set<number>>(new Set())
  const [showControls, setShowControls] = useState(false)
  // 每次进入播放器时随机打乱背景图片顺序
  const [shuffledImages] = useState(() => shuffleArray(BACKGROUND_IMAGES))
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop
  /** 播放过的句子增量收集（5s 节流写 progress: 记录） */
  const playedRef = useRef<{ indexes: Set<number>; dirty: boolean; lastFlush: number }>({ indexes: new Set(), dirty: false, lastFlush: 0 })
  /** 状态更新节流：记录上次 setCurrentMs 的时间戳 */
  const lastMsUpdateRef = useRef(0)

  // 数据侧：按 :materialId 从 IDB 读取材料与字幕；不存在则跳回材料库。
  // 媒体 Blob → ObjectURL 在进入页面时创建、组件卸载时 revoke（SSR 安全：仅在 useEffect 内访问）。
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    ;(async () => {
      const rec = await getMaterialRecord(materialId)
      if (cancelled) return
      if (!rec) { setNotFound(true); return }
      setRecord(rec)
      setDurationMs(rec.material.durationMs)
      void touchMaterial(materialId)
      const blob = await getMediaBlob(materialId)
      if (cancelled) return
      if (blob) {
        objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl)
        // 保存 File 对象用于 AI 转字幕
        const file = new File([blob], rec.material.mediaFileName || 'media', { type: blob.type })
        setMediaFile(file)
      }
      // 收藏集合：records store 中 fav:{materialId}:* 前缀
      const keys = await recordsStore.allKeys()
      if (cancelled) return
      const prefix = `fav:${materialId}:`
      setFavSet(new Set(keys.filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length))).filter((n) => !Number.isNaN(n))))
      // 恢复上次播放位置
      const progress = await getProgress(materialId)
      if (cancelled || !progress) return
      playedRef.current.indexes = new Set(progress.playedSentenceIndexes)
    })().catch(() => { if (!cancelled) setNotFound(true) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [materialId])

  const isSeedDemo = record?.material.mediaRef.startsWith('seed://') ?? false
  const playable = !isSeedDemo && !!mediaUrl

  // 播放引擎装配：HtmlPlayerController + SentencePlayer（仅真实媒体材料）
  useEffect(() => {
    if (!record || !playable || !mediaUrl) return
    const sentences = record.subtitleData?.sentences ?? []
    const mediaType = record.material.mediaType
    // 音频材料复用页面隐藏 <audio>；视频材料复用页面隐藏 <video>
    const mediaEl = mediaType === 'video' ? videoRef.current : audioRef.current
    const controller = mediaEl
      ? new HtmlPlayerController(mediaType, mediaEl)
      : new HtmlPlayerController(mediaType)
    const sp = new SentencePlayer(controller, sentences)
    playerRef.current = sp
    // 应用 P10 设置的默认倍速与循环次数（仅装配时一次，后续由控件交互覆盖）
    if (rate !== 1) sp.setRate(rate)
    if (loop > 0) sp.setLoopTimes(loop)

    let cancelled = false
    controller.load({ type: mediaType, src: mediaUrl }).then(() => {
      if (cancelled) return
      setDurationMs(controller.getDurationMs() || record.material.durationMs)
    }).catch(() => { /* 加载失败：保持静态展示，控件可用但播放会报错提示 */ })

    sp.on('timeupdate', (ms) => {
      // 状态更新节流：每 100ms 最多更新一次 setCurrentMs，减少 React 重新渲染频率
      // 解决视频播放时主线程被 rAF 循环和 React 状态更新阻塞导致返回按钮无响应的问题
      const now = Date.now()
      if (now - lastMsUpdateRef.current >= 100) {
        lastMsUpdateRef.current = now
        setCurrentMs(ms)
      }

      // 播放过的句子：随进度增量标记 + 5s 节流落盘
      const idx = sp.getCurrentSentenceIndex()
      if (idx >= 0 && !playedRef.current.indexes.has(idx)) {
        playedRef.current.indexes.add(idx)
        playedRef.current.dirty = true
      }
      if (playedRef.current.dirty && Date.now() - playedRef.current.lastFlush >= PROGRESS_FLUSH_MS) void flushProgress()
    })
    sp.on('statechange', (s) => setPlaying(s === 'playing'))
    sp.on('sentencechange', (i) => {
      if (i < 0) return
      setActive(i)
      // A-B 循环跟随新句：切换句子后对新句重新设置循环区间
      if (loopRef.current > 0) sp.setLoopTimes(loopRef.current)
    })
    sp.on('error', () => setPlaying(false))

    return () => {
      cancelled = true
      // 卸载前先同步捕获播放位置，再异步落盘（destroy 后 controller 不可读）
      const lastMs = sp.getCurrentTimeMs()
      void flushProgress(lastMs)
      sp.destroy()
      controller.destroy()
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, playable, mediaUrl])

  /** 播放进度落盘（progress: 前缀）：合并历史 playedSentenceIndexes + 最新位置 */
  async function flushProgress(lastMs?: number) {
    const p = playedRef.current
    if (!p.dirty || !materialId) return
    p.dirty = false
    p.lastFlush = Date.now()
    try {
      const prev = await getProgress(materialId)
      const merged = new Set([...(prev?.playedSentenceIndexes ?? []), ...p.indexes])
      const entry: LearningProgress = {
        materialId,
        lastPositionMs: lastMs ?? playerRef.current?.getCurrentTimeMs() ?? prev?.lastPositionMs ?? 0,
        playedSentenceIndexes: [...merged].sort((a, b) => a - b),
        updatedAt: Date.now(),
      }
      await recordsStore.put(RECORD_KEYS.progress(materialId), entry)
    } catch { /* 存储失败静默：进度仅影响材料库百分比 */ }
  }

  // 键盘快捷键：空格 播放/暂停；←/→ 上/下一句（输入框聚焦时不触发）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      const sp = playerRef.current
      if (e.code === 'Space') {
        e.preventDefault()
        if (!sp || !playable) return
        if (sp.getState() === 'playing') sp.pause()
        else void sp.play()
      } else if (e.key === 'ArrowLeft' && sp && playable) {
        e.preventDefault()
        sp.prev()
      } else if (e.key === 'ArrowRight' && sp && playable) {
        e.preventDefault()
        sp.next()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [playable])

  const togglePlay = (v: boolean) => {
    const sp = playerRef.current
    if (!sp) return
    if (v) void sp.play()
    else sp.pause()
  }
  const selectSentence = (i: number) => {
    const sp = playerRef.current
    if (sp) sp.playSentence(i)
    else setActive(i) // 演示材料：仅切换高亮
  }
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1
    setRate(next)
    playerRef.current?.setRate(next)
  }
  const cycleLoop = (v: number) => {
    setLoop(v)
    playerRef.current?.setLoopTimes(v)
  }
  const handleVolumeChange = (v: number) => {
    setVolumeState(v)
    playerRef.current?.setVolume(v)
  }
  const toggleFavorite = async (sentenceIndex: number) => {
    const key = RECORD_KEYS.favorite(materialId, sentenceIndex)
    const has = favSet.has(sentenceIndex)
    const nextSet = new Set(favSet)
    if (has) { nextSet.delete(sentenceIndex); await recordsStore.delete(key) }
    else {
      nextSet.add(sentenceIndex)
      const fav: Favorite = { materialId, sentenceIndex, createdAt: Date.now() }
      await recordsStore.put(key, fav)
    }
    setFavSet(nextSet)
  }

  /** 导入字幕文件：解析后更新 record 并重新装配播放引擎 */
  const handleImportSubtitle = useCallback(async (file: File) => {
    if (!record) return
    try {
      const text = await file.text()
      const data = parseSubtitle(text, undefined, record.material.durationMs ?? undefined)
      const updatedRecord: MaterialRecord = {
        ...record,
        material: {
          ...record.material,
          subtitle: { ref: `idb://materials/${materialId}`, format: data.format, isBilingual: data.isBilingual, sentenceCount: data.sentences.length },
        },
        subtitleData: data,
      }
      await putMaterialRecord(updatedRecord)
      setRecord(updatedRecord)
      setActive(0)
    } catch {
      // 解析失败静默处理
    }
  }, [record, materialId])

  /** AI音频转字幕：打开对话框 */
  const handleAiConvert = useCallback(() => {
    setShowAiDialog(true)
  }, [])

  /** AI 生成的字幕导入 */
  const handleAiSubtitleGenerated = useCallback(async (srtText: string) => {
    if (!record) return
    try {
      const data = parseSubtitle(srtText, 'srt', record.material.durationMs ?? undefined)
      const updatedRecord: MaterialRecord = {
        ...record,
        material: {
          ...record.material,
          subtitle: { ref: `idb://materials/${materialId}`, format: data.format, isBilingual: data.isBilingual, sentenceCount: data.sentences.length },
        },
        subtitleData: data,
      }
      await putMaterialRecord(updatedRecord)
      setRecord(updatedRecord)
      setActive(0)
    } catch {
      // 解析失败静默处理
    }
  }, [record, materialId])

  /** 删除句子：移除后重排 index 并持久化 */
  const handleDeleteSentence = useCallback(async (index: number) => {
    if (!record?.subtitleData) return
    const updated = record.subtitleData.sentences
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, index: i }))
    const data = { ...record.subtitleData, sentences: updated }
    const updatedRecord: MaterialRecord = { ...record, subtitleData: data }
    await putMaterialRecord(updatedRecord)
    setRecord(updatedRecord)
    setActive((prev) => Math.min(prev, Math.max(0, updated.length - 1)))
  }, [record])

  /** 纠错保存：更新句子内容并持久化 */
  const handleEditSentenceSave = useCallback(async (updated: SubtitleSentence) => {
    if (!record?.subtitleData) return
    const sentences = [...record.subtitleData.sentences]
    sentences[updated.index] = updated
    const data = { ...record.subtitleData, sentences }
    const updatedRecord: MaterialRecord = { ...record, subtitleData: data }
    await putMaterialRecord(updatedRecord)
    setRecord(updatedRecord)
  }, [record])

  /** 打开纠错弹窗 */
  const handleEditSentenceOpen = useCallback((index: number, sentence: SubtitleSentence) => {
    setEditingSentence({ index, sentence })
  }, [])

  /** 字幕导出：下载为 SRT 文件 */
  const handleExportSubtitle = useCallback(() => {
    if (!record?.subtitleData) return
    const srt = exportSrt(record.subtitleData.sentences)
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${record.material.name}.srt`
    a.click()
    URL.revokeObjectURL(url)
  }, [record])

  /** 延迟隐藏控制栏（鼠标移出后 2s） */
  const scheduleHideControls = () => {
    clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 2000)
  }
  /** 视频区域鼠标移动：进入区域即显示控制栏 */
  const handleVideoMouseMove = () => {
    clearTimeout(controlsTimerRef.current)
    setShowControls(true)
  }
  const handleVideoMouseLeave = () => scheduleHideControls()
  const handleControlsMouseEnter = () => clearTimeout(controlsTimerRef.current)
  const handleControlsMouseLeave = () => scheduleHideControls()

  if (notFound) return <Navigate to="/" replace />
  if (!record) return <Shell back><div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">正在加载材料…</div></Shell>

  const sentences = record.subtitleData?.sentences ?? []
  const safeActive = Math.min(active, Math.max(0, sentences.length - 1))
  const current = sentences[safeActive]
  const favorited = favSet.has(safeActive)

  return <Shell back><div className="mx-auto flex max-w-[1440px] flex-col px-4 py-6 md:px-8"><div className="mb-6 flex items-center justify-between"><div><p className="text-sm text-muted-foreground">正在学习 · {record.material.mediaType === 'video' ? '视频' : '音频'} · {formatDuration(record.material.durationMs)}</p><h1 className="font-serif text-2xl font-semibold md:text-3xl">{record.material.name}</h1></div><Link to={`/training/${record.material.id}`} onClick={pauseAllMedia}><Button><Sparkles data-icon="inline-start" />进入训练</Button></Link></div><div className="grid h-[calc(100vh-180px)] gap-6 overflow-hidden lg:grid-cols-[1.6fr_1fr]"><div className="flex min-h-0 flex-col gap-4"><div className="relative flex min-h-72 flex-1 flex-col justify-end rounded-3xl bg-primary p-6 shadow-inner lg:min-h-[480px]" onMouseMove={handleVideoMouseMove} onMouseLeave={handleVideoMouseLeave}>{isSeedDemo && <p className="mb-3 self-start rounded-xl bg-primary-foreground/10 px-3 py-2 text-xs text-primary-foreground/90">演示材料（无音频）——导入真实材料后即可播放音视频</p>}{mediaUrl && record.material.mediaType === 'video' ? <video ref={videoRef} src={mediaUrl} preload="metadata" className="absolute inset-0 h-full w-full rounded-3xl object-contain" /> : <BackgroundCarousel images={shuffledImages} interval={8000} transitionDuration={1000} className="absolute inset-0 rounded-3xl" />}<div className="relative z-10 max-w-2xl rounded-2xl bg-primary-foreground/10 p-5 text-primary-foreground backdrop-blur"><p className="text-xs uppercase tracking-[0.2em] opacity-70">{sentences.length ? `${safeActive + 1} / ${sentences.length}` : '无字幕'}</p>{current ? <><p className="mt-2 text-xl font-medium leading-relaxed">{current.textEn}</p>{mode !== 'english' && current.textZh && <p className="mt-1 text-sm opacity-80">{current.textZh}</p>}</> : <p className="mt-2 text-xl font-medium leading-relaxed opacity-70">{record.material.name}</p>}</div><div className={`absolute inset-x-0 bottom-0 z-20 px-6 pb-4 pt-16 bg-gradient-to-t from-black/60 to-transparent rounded-b-3xl transition-opacity duration-300 max-md:pointer-events-auto max-md:opacity-100 ${showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onMouseEnter={handleControlsMouseEnter} onMouseLeave={handleControlsMouseLeave}><PlayerControlBar {...{playing,setPlaying:togglePlay,mode,setMode,loop,setLoop:cycleLoop,sentenceIndex:safeActive,setSentenceIndex:selectSentence,items:sentences,currentMs,durationMs,onSeek:(ms)=>playerRef.current?.seekTo(ms),rate,onRateCycle:cycleRate,volume,onVolumeChange:handleVolumeChange,disabled:!playable,isBilingual:record.subtitleData ? record.subtitleData.isBilingual : true}} /></div></div><Card><CardContent className="flex h-[7.5rem] items-center justify-between gap-4 p-5"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">当前句</p>{current ? <><p className="mt-2 line-clamp-2 text-lg leading-relaxed">{current.textEn}</p><p className="line-clamp-1 text-muted-foreground">{current.textZh}</p></> : <p className="mt-2 text-lg leading-relaxed text-muted-foreground">该材料暂无字幕</p>}</div><Button variant="outline" className="shrink-0" disabled={sentences.length === 0} onClick={() => void toggleFavorite(safeActive)} aria-pressed={favorited} aria-label={favorited ? '取消收藏当前句' : '收藏当前句'}><Star data-icon="inline-start" className={favorited ? 'fill-primary text-primary' : ''} /><span className="hidden sm:inline">{favorited ? '已收藏' : '收藏'}</span></Button></CardContent></Card>{mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}</div><SubtitleList mode={mode} active={safeActive} onSelect={selectSentence} items={sentences} favoriteIndexes={favSet} onImportSubtitle={(f) => void handleImportSubtitle(f)} onAiConvert={handleAiConvert} onDeleteSentence={(i) => void handleDeleteSentence(i)} onEditSentence={handleEditSentenceOpen} onExportSubtitle={handleExportSubtitle} /></div></div><AiTranscribeDialog open={showAiDialog} onOpenChange={setShowAiDialog} mediaFile={mediaFile} onSubtitleGenerated={(srt) => void handleAiSubtitleGenerated(srt)} /><SubtitleEditDialog open={!!editingSentence} onOpenChange={(open) => { if (!open) setEditingSentence(null) }} sentence={editingSentence?.sentence ?? null} onSave={(updated) => void handleEditSentenceSave(updated)} /></Shell>
}

export { Player }
