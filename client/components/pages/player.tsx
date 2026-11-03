import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Check, ChevronUp, Copy, Star, StickyNote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Shell, pauseAllMedia } from '@/components/shared/shell'
import { formatDuration, PlayerControlBar, SubtitleList } from '@/components/shared/player-parts'
import { WordBubble } from '@/components/shared/word-bubble'
import { ScrollFade } from '@/components/shared/scroll-fade'
import { BackgroundCarousel } from '@/components/shared/background-carousel'
import { AiTranscribeDialog } from '@/components/shared/ai-transcribe-dialog'
import { SubtitleEditDialog } from '@/components/shared/subtitle-edit-dialog'
import { TranslateDrawer } from '@/components/shared/translate-drawer'
import { SentenceNoteDrawer } from '@/components/shared/sentence-note-drawer'
import {
  getMaterialRecord,
  getMediaBlob,
  getProgress,
  putMaterialRecord,
  putProgress,
  shiftSentenceReferences,
  touchMaterial,
} from '@/stores/material-store'
import { favoriteSentenceIndexes, setFavorite } from '@/stores/favorite-store'
import { deleteSentenceNote, listNotes, saveSentenceNote } from '@/stores/note-store'
import { updateFrequencies } from '@/stores/vocab-store'
import type { MaterialRecord } from '@/platform/storage/schema'
import { HtmlPlayerController } from '@/platform/html-player'
import { SentencePlayer } from '@/core/player/sentence-player'
import { getDefaultLoop, getDefaultRate, PREF_RATES, type PrefRate } from '@/lib/pref-keys'
import { exportSrt, parseSubtitle, splitWords, SubtitleParseError } from '@/core/subtitle'
import { downloadBlob } from '@/lib/download'
import { copyText } from '@/lib/clipboard'
import type { LearningProgress } from '@/types/progress'
import type { SubtitleData, SubtitleMode, SubtitleSentence } from '@/types/subtitle'

/** 学习进度写入节流：5s（播放过的句子增量持久化） */
const PROGRESS_FLUSH_MS = 5000
/** 复制原文时的前缀（仅原文；译文按原样复制） */
const SENTENCE_ANALYSIS_PREFIX = '句子解析：'
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
  const [searchParams] = useSearchParams()
  const [record, setRecord] = useState<MaterialRecord | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [playing, setPlaying] = useState(false)
  const [showAiDialog, setShowAiDialog] = useState(false)
  const [editingSentence, setEditingSentence] = useState<{ index: number; sentence: SubtitleSentence } | null>(null)
  const [showTranslateDrawer, setShowTranslateDrawer] = useState(false)
  const [mode, setMode] = useState<SubtitleMode>('bilingual')
  // 默认循环次数/倍速读自 P10 设置（prefs；'inf' → Infinity；SSR 安全：getPref 内置降级）
  const [loop, setLoop] = useState(() => { const l = getDefaultLoop(); return l === 'inf' ? Number.POSITIVE_INFINITY : l })
  const [rate, setRate] = useState<number>(() => getDefaultRate())
  const [active, setActive] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  /** 媒体 metadata 加载完成，才允许把恢复位置 seek 到真实时间轴上 */
  const [mediaReady, setMediaReady] = useState(false)
  /** 待恢复的历史播放位置；收藏句 ?s=N 跳转优先 */
  const [resumePositionMs, setResumePositionMs] = useState<number | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [favSet, setFavSet] = useState<Set<number>>(new Set())
  // 句子笔记：sentenceIndex → Markdown 内容（本地缓存，编辑防抖落盘）
  const [noteMap, setNoteMap] = useState<Record<number, string>>({})
  /** 笔记抽屉锚定的句序号（null = 关闭；打开期间不随播放切句） */
  const [noteDrawerIndex, setNoteDrawerIndex] = useState<number | null>(null)
  /** 待落盘笔记（index → 定时器 + 最新内容）；卸载/换材料时立即 flush */
  const pendingNotesRef = useRef<Map<number, { timer: ReturnType<typeof setTimeout>; content: string }>>(new Map())
  const [showControls, setShowControls] = useState(false)
  /** 当前句折叠态：折叠后仅留标签/按钮行。视频区尺寸保持恒定——布局动画期间逐帧 resize
   *  播放中的 <video> 会反复触发解码器输出尺寸重配/重栅格化，是折叠卡顿的主因 */
  const [sentenceCollapsed, setSentenceCollapsed] = useState(false)
  // 每次进入播放器时随机打乱背景图片顺序
  const [shuffledImages] = useState(() => shuffleArray(BACKGROUND_IMAGES))
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** 最近一次指针类型（pointerdown/pointermove 时记录）：触屏/笔走「点按切换」显隐，鼠标走 mousemove 显隐 */
  const lastPointerTypeRef = useRef<string>('mouse')
  const currentSentenceRef = useRef<HTMLDivElement | null>(null)
  /** 收藏夹跳转定位（?s=N）：待播放引擎就绪后 seek 的目标句序号 */
  const jumpSentenceRef = useRef<number | null>(null)
  /** 当前句复制按钮的短暂回执（'en' 原文 / 'zh' 译文） */
  const [copiedKind, setCopiedKind] = useState<'en' | 'zh' | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** 复制成功的悬浮提示（fixed 定位锚在触发按钮上方，不受卡片 overflow-hidden 裁剪；id 变化以重放动画） */
  const [copyTip, setCopyTip] = useState<{ id: number; x: number; y: number } | null>(null)
  const copyTipTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** 页面级错误提示条（字幕导入/生成失败等 —— 失败必须可见，不能静默停在无字幕态） */
  const [errorBanner, setErrorBanner] = useState('')
  const errorBannerTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showErrorBanner = useCallback((msg: string) => {
    setErrorBanner(msg)
    clearTimeout(errorBannerTimerRef.current)
    errorBannerTimerRef.current = setTimeout(() => setErrorBanner(''), 8000)
  }, [])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<SentencePlayer | null>(null)
  const loopRef = useRef(loop)
  loopRef.current = loop
  /** 播放过的句子增量收集（5s 节流写 progress: 记录） */
  const playedRef = useRef<{ indexes: Set<number>; dirty: boolean; lastFlush: number }>({ indexes: new Set(), dirty: false, lastFlush: 0 })
  /** 引擎装配版本号：装配 effect 重建引擎后触发一次渲染，让 LiveControlBar 拿到新实例 */
  const [engineVersion, setEngineVersion] = useState(0)
  // 有笔记的句序号集合（memo：SubtitleList 浅比较 props 需要 stable 引用）。
  // 必须在下方「材料未就绪」提前 return 之前 —— Hooks 不允许条件调用
  const noteIndexes = useMemo(() => new Set(Object.entries(noteMap).filter(([, v]) => v.trim()).map(([k]) => Number(k))), [noteMap])

  // 数据侧：按 :materialId 从 IDB 读取材料与字幕；不存在则跳回材料库。
  // 媒体 Blob → ObjectURL 在进入页面时创建、组件卸载时 revoke（SSR 安全：仅在 useEffect 内访问）。
  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    // 换材料时复位页面态：避免上一个材料的 revoked media URL、收藏与进度短暂附着到新材料。
    setNotFound(false)
    setRecord(null)
    setMediaUrl(null)
    setMediaFile(null)
    setPlaying(false)
    setActive(0)
    setDurationMs(0)
    setFavSet(new Set())
    setMediaReady(false)
    setResumePositionMs(null)
    setNoteMap({})
    setNoteDrawerIndex(null)
    // 同步清空已播集合：下方异步块仅在材料有 progress 记录时才覆盖 playedRef，
    // 不清空的话（未来同路由复用组件时）首个 flush 会把上一材料的已播句写进新材料进度
    playedRef.current = { indexes: new Set(), dirty: false, lastFlush: 0 }
    ;(async () => {
      const rec = await getMaterialRecord(materialId)
      if (cancelled) return
      if (!rec) { setNotFound(true); return }
      setRecord(rec)
      setDurationMs(rec.material.durationMs)
      void touchMaterial(materialId)
      // 媒体/收藏/笔记/进度互不依赖（评审 #54：原五连串行事务各付一次
      // IDB 往返；并发后收藏/笔记/续播位置合计早数十 ms 展示）
      const [blob, favIndexes, notes, progress] = await Promise.all([
        getMediaBlob(materialId),
        favoriteSentenceIndexes(materialId),
        listNotes(materialId),
        getProgress(materialId),
      ])
      if (cancelled) return
      if (blob) {
        objectUrl = URL.createObjectURL(blob); setMediaUrl(objectUrl)
        // 保存 File 对象用于 AI 转字幕
        const file = new File([blob], rec.material.mediaFileName || 'media', { type: blob.type })
        setMediaFile(file)
      } else {
        setMediaUrl(null)
        setMediaFile(null)
      }
      // 收藏集合：records store 中 fav:{materialId}:* 前缀
      setFavSet(new Set(favIndexes))
      // 句子笔记：records store 中 note:{materialId}:* 前缀
      setNoteMap(Object.fromEntries(notes.map((n) => [n.sentenceIndex, n.content])))
      // 恢复上次播放位置
      if (!progress) return
      playedRef.current.indexes = new Set(progress.playedSentenceIndexes)
      setResumePositionMs(progress.lastPositionMs)
    })().catch(() => { if (!cancelled) setNotFound(true) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [materialId])

  // 收藏夹跳转（?s=N）：进入时定位到该句——先高亮（React 态），播放引擎就绪后再 seek（见装配 effect）。
  // URL 未变化时不会重跑，用户后续手动切句不受影响。
  useEffect(() => {
    const raw = searchParams.get('s')
    if (raw == null) return
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 0) return
    jumpSentenceRef.current = n
    setActive(n)
  }, [searchParams])

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
    setEngineVersion((v) => v + 1) // 触发渲染，LiveControlBar 订阅新实例
    // 应用 P10 设置的默认倍速（仅装配时一次，后续由控件交互覆盖）。
    // 注意：这里不能预挂单句循环 —— 装配时 lastIndex 尚为 -1，setLoopTimes 会把循环
    // 句钳到第 0 句；而续播/?s=N 的 seek 此时尚未发生（mediaReady 后才做），第一个
    // timeupdate 就会因已越过第 0 句句尾而立即回跳句首，销毁保存的播放位置并覆盖
    // progress: 记录（2026-11 全仓复审：数据损坏）。循环改由下方 sentencechange
    // 处理器在首个句子定位后按 loopRef 挂载 —— 无论从哪句开始播，行为等价。
    if (rate !== 1) sp.setRate(rate)

    let cancelled = false
    controller.load({ type: mediaType, src: mediaUrl }).then(() => {
      if (cancelled) return
      setDurationMs(controller.getDurationMs() || record.material.durationMs)
      // 收藏夹跳转（?s=N）：定位到该句句首，不自动播放（高亮已由 jumpSentenceRef 的消费方设置）
      const jump = jumpSentenceRef.current
      if (jump != null) {
        const target = sentences[jump]
        if (target) sp.seekTo(target.startMs)
        jumpSentenceRef.current = null // 无效 s 参数也消费掉，给进度恢复让路
      }
      setMediaReady(true)
    }).catch(() => { /* 加载失败：保持静态展示，控件可用但播放会报错提示 */ })

    sp.on('timeupdate', () => {
      // 进度条 currentMs 已下沉到 LiveControlBar 内部订阅（引擎侧 100ms 发射门控），
      // 这里只做播放进度标记 + 节流落盘 —— 播放期间不再触发整页重渲染
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
      setMediaReady(false)
      // 卸载前先同步捕获播放位置，再异步落盘（destroy 后 controller 不可读）
      const lastMs = sp.getCurrentTimeMs()
      void flushProgress(lastMs)
      sp.destroy()
      controller.destroy()
      playerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialId, playable, mediaUrl])

  // 媒体 metadata 就绪后恢复上次位置；?s=N 已在 load 回调中优先消费。
  useEffect(() => {
    if (!mediaReady || resumePositionMs === null) return
    if (jumpSentenceRef.current !== null) return
    const player = playerRef.current
    if (!player) return
    player.seekTo(resumePositionMs)
    setResumePositionMs(null)
  }, [mediaReady, resumePositionMs])

  // 字幕数据变化（AI 转字幕/文件导入、纠错、删句、整篇翻译）时同步句列表到已装配引擎：
  // 装配 effect 依赖 [materialId, playable, mediaUrl]，字幕更新不会重建引擎，
  // 不同步则引擎持有旧句列表（首次导入前为空），循环/切句等句子级控件全部静默失效。
  useEffect(() => {
    playerRef.current?.setSentences(record?.subtitleData?.sentences ?? [])
  }, [record?.subtitleData])

  /** 播放进度落盘（progress: 前缀）：合并历史 playedSentenceIndexes + 最新位置 */
  async function flushProgress(lastMs?: number) {
    const p = playedRef.current
    if (!materialId) return
    // 位置写入与 played 集合解耦：节流调用（无显式 lastMs）只在有增量时写；
    // 卸载/seek 后离开（显式传 lastMs）即使无增量也要落盘位置，否则续播起点回跳旧值
    if (!p.dirty && lastMs == null) return
    p.dirty = false
    p.lastFlush = Date.now()
    try {
      const prev = await getProgress(materialId)
      // 无历史记录且从未播过句：不凭空创建 progress 记录（纯 seek 不足以成为"学过"）
      if (!prev && !p.indexes.size) return
      const merged = new Set([...(prev?.playedSentenceIndexes ?? []), ...p.indexes])
      const entry: LearningProgress = {
        materialId,
        lastPositionMs: lastMs ?? playerRef.current?.getCurrentTimeMs() ?? prev?.lastPositionMs ?? 0,
        playedSentenceIndexes: [...merged].sort((a, b) => a - b),
        updatedAt: Date.now(),
      }
      await putProgress(entry)
    } catch { /* 存储失败静默：进度仅影响材料库百分比 */ }
  }

  // 键盘快捷键：空格 播放/暂停；←/→ 上/下一句（输入框聚焦时不触发）。
  // 任一浮层（纠错/AI 转写/翻译/笔记）打开时整体让位：模态内按空格应激活聚焦按钮
  // 而不是背后切播放，N 也不该在别的抽屉上再叠一层笔记抽屉（2026-11 全仓复审）
  const overlayOpen = !!editingSentence || showAiDialog || showTranslateDrawer || noteDrawerIndex != null
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (overlayOpen) return
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
  }, [playable, overlayOpen])

  // N 键打开当前句笔记抽屉（输入框聚焦时不触发；Esc/遮罩关闭由抽屉自理）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (overlayOpen) return
      if (e.key === 'n' || e.key === 'N') setNoteDrawerIndex(active)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, overlayOpen])

  /** 笔记编辑：本地即时更新（驱动预览），400ms 静默后落盘；空内容落盘时即删除 */
  const handleNoteChange = useCallback((index: number, content: string) => {
    setNoteMap((prev) => ({ ...prev, [index]: content }))
    const pending = pendingNotesRef.current
    const existing = pending.get(index)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      pending.delete(index)
      void saveSentenceNote(materialId, index, content)
    }, 400)
    pending.set(index, { timer, content })
  }, [materialId])

  /** 删除本句笔记：清本地缓存与待落盘项，直接删 store 记录 */
  const handleNoteDelete = useCallback((index: number) => {
    setNoteMap((prev) => { const next = { ...prev }; delete next[index]; return next })
    const existing = pendingNotesRef.current.get(index)
    if (existing) { clearTimeout(existing.timer); pendingNotesRef.current.delete(index) }
    void deleteSentenceNote(materialId, index)
  }, [materialId])

  // 卸载/换材料：立即 flush 尚未落盘的笔记（自动保存不能因离开页面而丢失）
  useEffect(() => () => {
    for (const [index, p] of pendingNotesRef.current) {
      clearTimeout(p.timer)
      void saveSentenceNote(materialId, index, p.content)
    }
    pendingNotesRef.current.clear()
  }, [materialId])

  const togglePlay = (v: boolean) => {
    const sp = playerRef.current
    if (!sp) return
    if (v) void sp.play()
    else sp.pause()
  }
  // 稳定引用（供 SubtitleList memo 生效）：内部只读 ref 与 setState
  const selectSentence = useCallback((i: number) => {
    const sp = playerRef.current
    if (sp) sp.playSentence(i)
    else setActive(i) // 演示材料：仅切换高亮
  }, [])
  const cycleRate = () => {
    // 倍速循环序列即设置页的 PREF_RATES（单一出处，改档位两处同步）
    const next = PREF_RATES[(PREF_RATES.indexOf(rate as PrefRate) + 1) % PREF_RATES.length] ?? 1
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
    const has = favSet.has(sentenceIndex)
    await setFavorite(materialId, sentenceIndex, !has)
    // 函数式更新（评审 #30）：两次收藏在 IDB 往返窗口内交错时，
    // 后到者不得用渲染闭包里的旧 favSet 覆盖前者的结果
    setFavSet((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(sentenceIndex)) nextSet.delete(sentenceIndex)
      else nextSet.add(sentenceIndex)
      return nextSet
    })
  }

  /** 将已解析的字幕数据应用到当前材料：持久化 + 更新生词频率 + 刷新 UI */
  const applySubtitleToRecord = useCallback(async (data: SubtitleData) => {
    if (!record) return
    const updatedRecord: MaterialRecord = {
      ...record,
      material: {
        ...record.material,
        subtitle: { ref: `idb://materials/${materialId}`, format: data.format, isBilingual: data.isBilingual, sentenceCount: data.sentences.length },
      },
      subtitleData: data,
    }
    await putMaterialRecord(updatedRecord)
    const allWords = data.sentences.flatMap((s) => s.words)
    await updateFrequencies(allWords, materialId)
    setRecord(updatedRecord)
    setActive(0)
  }, [record, materialId])

  /** 导入字幕文件：解析后更新 record 并重新装配播放引擎 */
  const handleImportSubtitle = useCallback(async (file: File) => {
    if (!record) return
    try {
      const text = await file.text()
      const data = parseSubtitle(text, undefined, record.material.durationMs ?? undefined)
      await applySubtitleToRecord(data)
    } catch (e) {
      // 失败必须可见：SubtitleParseError 自带坏行行号（core/subtitle 的设计目的就是定位）
      console.error('[player] 字幕导入失败:', e)
      showErrorBanner(e instanceof SubtitleParseError ? `字幕解析失败（第 ${e.line} 行）：${e.message}` : '字幕导入失败，请检查文件格式')
    }
  }, [record, applySubtitleToRecord, showErrorBanner])

  /** AI音频转字幕：打开对话框 */
  const handleAiConvert = useCallback(() => {
    setShowAiDialog(true)
  }, [])

  /** AI 生成的字幕导入 */
  const handleAiSubtitleGenerated = useCallback(async (srtText: string) => {
    if (!record) return
    try {
      const data = parseSubtitle(srtText, 'srt', record.material.durationMs ?? undefined)
      await applySubtitleToRecord(data)
    } catch (e) {
      console.error('[player] AI 字幕应用失败:', e)
      showErrorBanner('AI 生成的字幕解析失败，未导入' + (e instanceof SubtitleParseError ? `（第 ${e.line} 行）` : ''))
    }
  }, [record, applySubtitleToRecord, showErrorBanner])

  /** 删除句子：移除后重排 index 并持久化；笔记/收藏/播放进度 key 全部跟随平移（被删句自身删除，其后句序号 -1） */
  const handleDeleteSentence = useCallback(async (index: number) => {
    if (!record?.subtitleData) return
    // ① 先把待落盘的笔记按「位移前」索引落盘：400ms 防抖定时器若不在删句前收口，
    //    会在平移完成后带着旧索引把笔记写到错误的句子上（或在被删句槽位复活笔记）
    for (const [i, p] of pendingNotesRef.current) {
      clearTimeout(p.timer)
      await saveSentenceNote(materialId, i, p.content)
    }
    pendingNotesRef.current.clear()

    const updated = record.subtitleData.sentences
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, index: i }))
    const data = { ...record.subtitleData, sentences: updated }
    const updatedRecord: MaterialRecord = {
      ...record,
      material: record.material.subtitle
        ? { ...record.material, subtitle: { ...record.material.subtitle, sentenceCount: updated.length } }
        : record.material,
      subtitleData: data,
    }
    await putMaterialRecord(updatedRecord)
    // ② 句序相关持久化记录统一由 store 平移（含进度，防止任何家族漏同步）。
    const shiftedProgress = await shiftSentenceReferences(materialId, index)
    await updateFrequencies(updated.flatMap((sentence) => sentence.words), materialId)
    setFavSet((prev) => {
      const next = new Set<number>()
      for (const i of prev) {
        if (i === index) continue
        next.add(i > index ? i - 1 : i)
      }
      return next
    })
    // ③ 已播进度在内存中同步为 store 返回的持久化结果；store 无落盘记录（返回
    // undefined，如播放不足 PROGRESS_FLUSH_MS 还没写过 progress:）时就地平移内存
    // 集合——r3 复审回归：原写法在该分支把已播集合清空，脏标记使其后 flush 写不回，
    // 已播标记永久丢失。
    if (shiftedProgress) {
      playedRef.current.indexes = new Set(shiftedProgress.playedSentenceIndexes)
    } else {
      const next = new Set<number>()
      for (const i of playedRef.current.indexes) {
        if (i === index) continue
        next.add(i > index ? i - 1 : i)
      }
      playedRef.current.indexes = next
    }
    setNoteMap((prev) => {
      const next: Record<number, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k)
        if (i === index) continue
        next[i > index ? i - 1 : i] = v
      }
      return next
    })
    setNoteDrawerIndex((prev) => (prev == null ? prev : prev === index ? null : prev > index ? prev - 1 : prev))
    setRecord(updatedRecord)
    setActive((prev) => Math.min(prev, Math.max(0, updated.length - 1)))
  }, [record, materialId])

  /** 纠错/单句翻译保存：更新句子内容并持久化；补译文后同步 isBilingual（播放器据此开放中文模式） */
  const handleEditSentenceSave = useCallback(async (updated: SubtitleSentence) => {
    if (!record?.subtitleData) return
    const sentences = [...record.subtitleData.sentences]
    // 兜底校验（弹窗已按邻句范围拦截）：句子数组必须保持按 startMs 有序 ——
    // locateSentence 二分查找、笔记/收藏/进度的句序映射都依赖它。原位写入无序时间
    // 会静默破坏高亮与播放控制并持久化到 IDB（2026-11 全仓复审：数据损坏）。
    const prev = sentences[updated.index - 1]
    const next = sentences[updated.index + 1]
    if ((prev && updated.startMs <= prev.startMs) || (next && updated.startMs >= next.startMs)) {
      showErrorBanner('起始时间需晚于上一句且早于下一句（保持时间轴有序），已取消保存')
      return
    }
    sentences[updated.index] = { ...updated, words: splitWords(updated.textEn) }
    const isBilingual = sentences.some((s) => !!s.textZh)
    const data = { ...record.subtitleData, sentences, isBilingual }
    const updatedRecord: MaterialRecord = {
      ...record,
      material: record.material.subtitle
        ? { ...record.material, subtitle: { ...record.material.subtitle, isBilingual } }
        : record.material,
      subtitleData: data,
    }
    await putMaterialRecord(updatedRecord)
    setRecord(updatedRecord)
  }, [record, showErrorBanner])

  /** 打开纠错弹窗 */
  const handleEditSentenceOpen = useCallback((index: number, sentence: SubtitleSentence) => {
    setEditingSentence({ index, sentence })
  }, [])

  /** 字幕导出：下载为 SRT 文件 */
  const handleExportSubtitle = useCallback(() => {
    if (!record?.subtitleData) return
    const srt = exportSrt(record.subtitleData.sentences)
    downloadBlob(`${record.material.name}.srt`, new Blob([srt], { type: 'text/plain;charset=utf-8' }))
  }, [record])

  /** 翻译入口：整篇翻译抽屉（单句翻译在字幕编辑弹窗内） */
  const handleTranslate = useCallback(() => setShowTranslateDrawer(true), [])

  /** 批量翻译应用：更新所有句子并持久化，自动切换为双语模式 */
  const handleTranslateApplyAll = useCallback(async (updatedSentences: SubtitleSentence[], _direction: 'en2zh' | 'zh2en') => {
    if (!record?.subtitleData) return
    const sub = record.material.subtitle!
    const data = {
      ...record.subtitleData,
      sentences: updatedSentences.map((sentence) => ({ ...sentence, words: splitWords(sentence.textEn) })),
      isBilingual: true,
    }
    const updatedRecord: MaterialRecord = {
      ...record,
      material: { ...record.material, subtitle: { ref: sub.ref, format: sub.format, sentenceCount: sub.sentenceCount, isBilingual: true } },
      subtitleData: data,
    }
    await putMaterialRecord(updatedRecord)
    setRecord(updatedRecord)
    setMode('bilingual')
  }, [record])

  /** 复制当前句原文/译文：成功后按钮短暂显示对勾回执 + 按钮上方浮出「复制成功」提示；原文带「句子解析：」前缀，粘贴到笔记/AI 时自带上下文 */
  const handleCopySentence = useCallback(async (kind: 'en' | 'zh', text: string, anchor?: HTMLElement | null) => {
    if (!text.trim()) return
    const payload = kind === 'en' ? `${SENTENCE_ANALYSIS_PREFIX}${text}` : text
    if (!(await copyText(payload))) return
    setCopiedKind(kind)
    clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedKind(null), 1500)
    if (anchor) {
      const r = anchor.getBoundingClientRect()
      setCopyTip((prev) => ({ id: (prev?.id ?? 0) + 1, x: r.left + r.width / 2, y: r.top }))
      clearTimeout(copyTipTimerRef.current)
      copyTipTimerRef.current = setTimeout(() => setCopyTip(null), 1400)
    }
  }, [])

  // 卸载时清掉复制回执、悬浮提示与错误提示定时器
  useEffect(() => () => { clearTimeout(copiedTimerRef.current); clearTimeout(copyTipTimerRef.current); clearTimeout(errorBannerTimerRef.current) }, [])

  /** 延迟隐藏控制栏（鼠标移出后 2s / 触屏唤出后 2s 无操作） */
  const scheduleHideControls = () => {
    clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 2000)
  }
  /** 立即收起控制栏 */
  const hideControlsNow = () => {
    clearTimeout(controlsTimerRef.current)
    setShowControls(false)
  }
  /** 记录指针类型：click 是 MouseEvent 看不到来源，借 pointerdown/pointermove 传入的类型 */
  const syncPointerType = (e: React.PointerEvent) => {
    lastPointerTypeRef.current = e.pointerType
  }
  /** 视频区域鼠标移动：进入区域即显示控制栏。
   *  触屏端忽略点按触发的模拟 mouse 事件，显隐完全由 handleVideoAreaTap 驱动，
   *  否则模拟 mousemove（随点按派发）会先把栏显示出来，点按切换随即又把它收起。 */
  const handleVideoMouseMove = () => {
    if (lastPointerTypeRef.current !== 'mouse') return
    clearTimeout(controlsTimerRef.current)
    setShowControls(true)
  }
  /** 触屏/笔：点按视频区域切换控制栏 —— 唤出后 2s 无操作自动收起，再点立即收起 */
  const handleVideoAreaTap = () => {
    if (lastPointerTypeRef.current === 'mouse') return
    if (showControls) hideControlsNow()
    else {
      setShowControls(true)
      scheduleHideControls()
    }
  }
  /** 控制栏浮层点按：不冒泡到视频区（防误触切换）；点在渐变空白处直接收起 */
  const handleOverlayTap = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (lastPointerTypeRef.current !== 'mouse' && e.target === e.currentTarget) hideControlsNow()
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

  const noted = !!noteMap[safeActive]?.trim()

  return <Shell back><div className="mx-auto flex max-w-[1440px] flex-col px-4 py-6 md:px-8"><div className="mb-6"><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">正在学习 · {record.material.mediaType === 'video' ? '视频' : '音频'} · {formatDuration(record.material.durationMs)}</p><Link className="shrink-0" to={`/training/${record.material.id}`} onClick={pauseAllMedia}><Button>进入训练</Button></Link></div><h1 className="truncate font-serif text-2xl font-semibold md:text-3xl" title={record.material.name}>{record.material.name}</h1></div>{errorBanner && <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert"><span>{errorBanner}</span><button className="shrink-0 underline-offset-2 hover:underline" onClick={() => setErrorBanner('')}>关闭</button></div>}<div className="grid gap-6 lg:h-[calc(100vh-180px)] lg:grid-cols-[2fr_1fr] lg:overflow-hidden"><div className="flex min-h-0 flex-col gap-4"><div className="relative aspect-video rounded-3xl bg-primary shadow-inner lg:aspect-auto lg:flex-1 lg:min-h-[480px] lg:max-h-[480px]" onMouseMove={handleVideoMouseMove} onMouseLeave={handleVideoMouseLeave} onPointerDown={syncPointerType} onPointerMove={syncPointerType} onClick={handleVideoAreaTap}>{isSeedDemo && <p className="absolute inset-x-6 top-6 z-10 rounded-xl bg-primary-foreground/10 px-3 py-2 text-xs text-primary-foreground/90">演示材料（无音频）——导入真实材料后即可播放音视频</p>}{mediaUrl && record.material.mediaType === 'video' ? <video ref={videoRef} src={mediaUrl} preload="metadata" className="absolute inset-0 h-full w-full rounded-3xl object-contain" /> : <BackgroundCarousel images={shuffledImages} interval={8000} transitionDuration={1000} className="absolute inset-0 rounded-3xl" />}<div className={`absolute inset-x-0 bottom-0 z-20 px-6 pb-4 pt-16 bg-gradient-to-t from-black/60 to-transparent rounded-b-3xl transition-opacity duration-300 ${showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onMouseEnter={handleControlsMouseEnter} onMouseLeave={handleControlsMouseLeave} onClick={handleOverlayTap}><LiveControlBar key={engineVersion} player={playerRef.current} {...{playing,setPlaying:togglePlay,mode,setMode,loop,setLoop:cycleLoop,sentenceIndex:safeActive,setSentenceIndex:selectSentence,items:sentences,durationMs,onSeek:(ms)=>playerRef.current?.seekTo(ms),rate,onRateCycle:cycleRate,volume,onVolumeChange:handleVolumeChange,disabled:!playable,isBilingual:record.subtitleData ? record.subtitleData.isBilingual : true}} /></div></div><Card ref={currentSentenceRef} className="py-0"><CardContent className="flex items-center py-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><Button variant="ghost" size="xs" className="-ml-2 gap-0.5 font-semibold uppercase tracking-wider text-primary" aria-expanded={!sentenceCollapsed} aria-label={sentenceCollapsed ? '展开当前句' : '折叠当前句'} title={sentenceCollapsed ? '展开当前句' : '折叠当前句'} onClick={() => setSentenceCollapsed(v => !v)}>当前句<ChevronUp data-icon="inline-end" className={`size-3.5 transition-transform duration-200 ${sentenceCollapsed ? 'rotate-180' : ''}`} /></Button><Button variant="ghost" size="xs" className="text-muted-foreground" disabled={!current?.textEn} title="复制原文" aria-label="复制原文" onClick={(e) => void handleCopySentence('en', current?.textEn ?? '', e.currentTarget)}>{copiedKind === 'en' ? <Check data-icon="inline-start" className="text-primary" /> : <Copy data-icon="inline-start" />}原文</Button><Button variant="ghost" size="xs" className="text-muted-foreground" disabled={!current?.textZh} title="复制译文" aria-label="复制译文" onClick={(e) => void handleCopySentence('zh', current?.textZh ?? '', e.currentTarget)}>{copiedKind === 'zh' ? <Check data-icon="inline-start" className="text-primary" /> : <Copy data-icon="inline-start" />}译文</Button><Button variant={noted ? 'secondary' : 'outline'} size="xs" disabled={sentences.length === 0} onClick={() => setNoteDrawerIndex(safeActive)} aria-label={noted ? `查看句子 ${safeActive + 1} 的笔记` : `为句子 ${safeActive + 1} 记笔记`}><StickyNote data-icon="inline-start" className={noted ? 'text-primary' : ''} /><span className="hidden sm:inline">{noted ? '查看笔记' : '记笔记'}</span><kbd className="hidden rounded border px-1 text-[10px] font-normal text-muted-foreground sm:inline">N</kbd></Button><Button variant="outline" size="xs" className="ml-auto shrink-0" disabled={sentences.length === 0} onClick={() => void toggleFavorite(safeActive)} aria-pressed={favorited} aria-label={favorited ? '取消收藏当前句' : '收藏当前句'}><Star data-icon="inline-start" className={favorited ? 'fill-primary text-primary' : ''} /><span className="hidden sm:inline">{favorited ? '已收藏' : '收藏'}</span></Button></div><div className={`grid transition-[grid-template-rows] duration-200 ease-out ${sentenceCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}><div className={`min-h-0 overflow-hidden transition-opacity duration-150 ${sentenceCollapsed ? 'opacity-0' : 'opacity-100'}`}><ScrollFade className="mt-1.5 h-[7.5rem]" resetKey={safeActive}>{current ? <>{(mode === 'bilingual' || mode === 'english') && <p className="whitespace-pre-line text-lg leading-relaxed select-text">{current.textEn}</p>}{(mode === 'bilingual' || mode === 'chinese') && <p className="mt-1 whitespace-pre-line text-muted-foreground">{current.textZh}</p>}</> : <p className="text-lg leading-relaxed text-muted-foreground">该材料暂无字幕</p>}</ScrollFade></div></div></div></CardContent></Card><WordBubble items={sentences} materialId={record.material.id} selectionContainerRef={currentSentenceRef} />{mediaUrl && record.material.mediaType === 'audio' && <audio ref={audioRef} src={mediaUrl} preload="metadata" className="hidden" />}</div><SubtitleList mode={mode} active={safeActive} onSelect={selectSentence} items={sentences} favoriteIndexes={favSet} noteIndexes={noteIndexes} onOpenNote={setNoteDrawerIndex} onImportSubtitle={handleImportSubtitle} onAiConvert={handleAiConvert} onDeleteSentence={handleDeleteSentence} onEditSentence={handleEditSentenceOpen} onExportSubtitle={handleExportSubtitle} onTranslate={handleTranslate} /></div></div>{copyTip && <div key={copyTip.id} role="status" aria-live="polite" className="animate-copy-tip pointer-events-none fixed z-50 flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-lg" style={{ left: copyTip.x, top: copyTip.y - 6 }}><Check className="size-3" />复制成功</div>}<AiTranscribeDialog open={showAiDialog} onOpenChange={setShowAiDialog} mediaFile={mediaFile} onSubtitleGenerated={(srt) => void handleAiSubtitleGenerated(srt)} /><SubtitleEditDialog open={!!editingSentence} onOpenChange={(open) => { if (!open) setEditingSentence(null) }} sentence={editingSentence?.sentence ?? null} onSave={(updated) => void handleEditSentenceSave(updated)} prevStartMs={editingSentence ? sentences[editingSentence.index - 1]?.startMs : undefined} nextStartMs={editingSentence ? sentences[editingSentence.index + 1]?.startMs : undefined} /><TranslateDrawer open={showTranslateDrawer} onOpenChange={setShowTranslateDrawer} sentences={sentences} onApplyAll={(updated, direction) => void handleTranslateApplyAll(updated, direction)} /><SentenceNoteDrawer open={noteDrawerIndex != null} target={noteDrawerIndex != null ? (sentences[noteDrawerIndex] ?? null) : null} content={noteDrawerIndex != null ? (noteMap[noteDrawerIndex] ?? '') : ''} onChange={(v) => { if (noteDrawerIndex != null) handleNoteChange(noteDrawerIndex, v) }} onDelete={() => { if (noteDrawerIndex != null) handleNoteDelete(noteDrawerIndex) }} onLocate={() => { if (noteDrawerIndex != null) { selectSentence(noteDrawerIndex); setNoteDrawerIndex(null) } }} onClose={() => setNoteDrawerIndex(null)} /></Shell>
}

/**
 * 进度条专用包装：订阅引擎 timeupdate 把 currentMs 局限在本组件内部 ——
 * 播放期间的 ~10Hz 更新只重渲染控制条，不再带动整页 reconcile
 * （千句字幕列表每秒万级 diff 的问题由此消除；引擎侧已有 100ms 发射门控，无需再节流）。
 */
function LiveControlBar({ player, ...barProps }: Omit<React.ComponentProps<typeof PlayerControlBar>, 'currentMs'> & { player: SentencePlayer | null }) {
  const [currentMs, setCurrentMs] = useState(0)
  useEffect(() => {
    if (!player) return
    setCurrentMs(player.getCurrentTimeMs())
    player.on('timeupdate', setCurrentMs)
    return () => { player.off('timeupdate', setCurrentMs) }
  }, [player])
  return <PlayerControlBar {...barProps} currentMs={currentMs} />
}

export { Player }
