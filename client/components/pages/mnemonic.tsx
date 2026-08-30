/**
 * 生词助记页面 —— 卡片式布局，分层加载助记内容
 *
 * 路由：/vocabulary/mnemonic/:entryId
 *
 * 加载逻辑：
 * 1. 从 URL 获取 entryId → vocabStore.getEntryById 获取词条
 * 2. 检查 mnemonicStore 缓存 → 有则直接渲染
 * 3. 无缓存 → 调用 mnemonicService.generateCard() → 渲染 + 存缓存
 * 4. difficulty=hard 时自动展开联想区域
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Lightbulb,
  Loader2,
  Mic,
  PenLine,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { getServices } from '@/services'
import { initVocab, vocabStore } from '@/stores/vocab-store'
import { useStore } from '@/stores/store'
import {
  getMnemonicFromMemory,
  loadMnemonic,
  saveMnemonic,
  saveAssociation,
  saveExercises,
  clearMnemonic,
} from '@/stores/mnemonic-store'
import type { VocabEntry } from '@/types/vocabulary'
import type {
  MnemonicCard,
  Association,
  Exercises,
  SentenceEvaluation,
} from '@/types/mnemonic'

const services = getServices()

const difficultyLabel: Record<string, { text: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  easy: { text: '简单', variant: 'secondary' },
  medium: { text: '中等', variant: 'default' },
  hard: { text: '困难', variant: 'destructive' },
}

/** 渲染含 ** 加粗的文本 */
function BoldText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-primary">
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ─── 卡片组件 ───

function CoreMeaningCard({ data }: { data?: MnemonicCard['core_meaning'] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <CardTitle>核心含义</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <div className="text-base font-medium">{data.primary}</div>
            {Array.isArray(data.extended) && data.extended.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">引申义</div>
                <ul className="space-y-1">
                  {data.extended.map((ext, i) => (
                    <li key={i} className="text-sm text-muted-foreground">
                      • {ext}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm italic text-muted-foreground">
              {data.semantic_range}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            <div className="h-4 w-72 animate-pulse rounded bg-muted" />
            <div className="h-4 w-60 animate-pulse rounded bg-muted" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PhoneticCard({ data }: { data?: MnemonicCard['phonetic_mnemonic'] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" />
          <CardTitle>发音助记</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <div className="font-mono text-lg">{data.syllables}</div>
            <div className="text-sm">{data.sound_shape}</div>
            {Array.isArray(data.homophones_rhymes) && data.homophones_rhymes.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">谐音 / 押韵</div>
                <div className="flex flex-wrap gap-2">
                  {data.homophones_rhymes.map((w, i) => (
                    <Badge key={i} variant="outline">{w}</Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="h-6 w-32 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WordRootsCard({ data }: { data?: MnemonicCard['word_roots'] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-primary" />
          <CardTitle>词根词缀</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <div className="text-sm font-medium">{data.breakdown}</div>
            {Array.isArray(data.root_family) && data.root_family.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">同根词家族</div>
                <div className="space-y-1">
                  {data.root_family.map((item, i) => (
                    <div key={i} className="flex items-baseline gap-2 text-sm">
                      <span className="font-medium">{item.word}</span>
                      <span className="text-muted-foreground">{item.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.hook && (
              <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                💡 {data.hook}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-52 animate-pulse rounded bg-muted" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExamplesCard({ data }: { data?: MnemonicCard['examples'] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PenLine className="size-4 text-primary" />
          <CardTitle>例句</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.isArray(data) ? data.map((ex, i) => (
          <div key={i} className="space-y-1">
            <div className="text-sm">
              <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
              <BoldText text={ex.sentence} />
            </div>
            <div className="pl-5 text-sm text-muted-foreground">{ex.translation}</div>
            {ex.usage_note && (
              <div className="pl-5 text-xs text-muted-foreground/70">📌 {ex.usage_note}</div>
            )}
          </div>
        )) : (
          <div className="space-y-3">
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CollocationsCard({ data }: { data?: MnemonicCard['collocations'] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <CardTitle>词组搭配</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.isArray(data) ? data.map((col, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{col.phrase}</span>
                <span className="text-sm text-muted-foreground">{col.meaning}</span>
              </div>
              <div className="pl-3 text-xs text-muted-foreground/70">例：{col.example}</div>
            </div>
          )) : (
            <div className="space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function AssociationCard({
  entryId,
  word,
  meaning,
  initial,
  autoLoad,
}: {
  entryId: string
  word: string
  meaning: string
  initial?: Association
  autoLoad?: boolean
}) {
  const [data, setData] = useState<Association | undefined>(initial)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    try {
      const result = await services.mnemonic.generateAssociation(word, meaning)
      setData(result)
      await saveAssociation(entryId, result)
    } finally {
      setLoading(false)
    }
  }, [entryId, word, meaning])

  useEffect(() => {
    if (autoLoad && !data && !loading) {
      generate()
    }
  }, [autoLoad, data, loading, generate])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" />
          <CardTitle>联想记忆</CardTitle>
        </div>
        {data && (
          <CardDescription>类型：{data.type === 'image' ? '图像联想' : data.type === 'story' ? '故事联想' : data.type === 'sound_play' ? '谐音联想' : '夸张联想'}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {data ? (
          <div className="space-y-2">
            <div className="text-sm">{data.content}</div>
            <div className="text-xs text-muted-foreground">✅ {data.why_it_works}</div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={generate} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                生成中…
              </>
            ) : (
              <>
                <Lightbulb className="mr-2 size-4" />
                生成联想记忆
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function ExercisesSection({
  entryId,
  word,
  meaning,
  collocations,
  difficulty,
  initial,
}: {
  entryId: string
  word: string
  meaning: string
  collocations: string[]
  difficulty: string
  initial?: Exercises
}) {
  const [exercises, setExercises] = useState<Exercises | undefined>(initial)
  const [loading, setLoading] = useState(false)
  const [userSentence, setUserSentence] = useState('')
  const [evaluation, setEvaluation] = useState<SentenceEvaluation | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null)

  const generateExercises = useCallback(async () => {
    setLoading(true)
    try {
      const result = await services.mnemonic.generateExercises(word, meaning, collocations, difficulty)
      setExercises(result)
      await saveExercises(entryId, result)
    } finally {
      setLoading(false)
    }
  }, [entryId, word, meaning, collocations, difficulty])

  const submitSentence = useCallback(async () => {
    if (!userSentence.trim()) return
    setEvaluating(true)
    try {
      const result = await services.mnemonic.evaluateSentence(word, meaning, userSentence)
      setEvaluation(result)
    } finally {
      setEvaluating(false)
    }
  }, [word, meaning, userSentence])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <PenLine className="size-4 text-primary" />
          <CardTitle>深度练习</CardTitle>
        </div>
        <CardDescription>主动提取 + 输出，从被动词汇到主动词汇</CardDescription>
      </CardHeader>
      <CardContent>
        {exercises ? (
          <div className="space-y-6">
            {/* 填空题 */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">IELTS 填空</div>
              <div className="text-sm">{exercises.ielts_blank.sentence}</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {Array.isArray(exercises.ielts_blank.options) && exercises.ielts_blank.options.map((opt, i) => {
                  const letter = opt.charAt(0)
                  const isSelected = selectedAnswer === letter
                  const isCorrect = letter === exercises.ielts_blank.answer
                  return (
                    <button
                      key={i}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selectedAnswer
                          ? isCorrect
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : isSelected
                              ? 'border-red-500 bg-red-50 text-red-700'
                              : 'border-border opacity-50'
                          : 'hover:bg-muted'
                      }`}
                      onClick={() => !selectedAnswer && setSelectedAnswer(letter)}
                      disabled={!!selectedAnswer}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
              {selectedAnswer && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {exercises.ielts_blank.explanation}
                </div>
              )}
            </div>

            {/* 听力辨别 */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">听力辨别</div>
              {Array.isArray(exercises.listening_spot) && exercises.listening_spot.map((spot, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={spot.difficulty === 'easy' ? 'secondary' : 'destructive'}>
                      {spot.difficulty === 'easy' ? '易' : '难'}
                    </Badge>
                    <span className="text-sm">{spot.sentence}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">🎧 {spot.phonetic_hint}</div>
                </div>
              ))}
            </div>

            {/* 造句练习 */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">造句练习</div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">{exercises.writing_prompt}</div>
              <Textarea
                placeholder="用这个单词写一个句子…"
                value={userSentence}
                onChange={(e) => { setUserSentence(e.target.value); setEvaluation(null) }}
                rows={3}
                className="text-sm"
              />
              <Button size="sm" onClick={submitSentence} disabled={!userSentence.trim() || evaluating}>
                {evaluating ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    批改中…
                  </>
                ) : (
                  '提交造句'
                )}
              </Button>
              {evaluation && (
                <div className={`rounded-lg border p-3 ${evaluation.is_correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="mb-2 flex items-center gap-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      语法 {evaluation.grammar_score}/5
                    </span>
                    <span className="text-xs font-medium text-muted-foreground">
                      用词 {evaluation.usage_score}/5
                    </span>
                  </div>
                  <div className="text-sm">{evaluation.feedback}</div>
                  {evaluation.improved_version && (
                    <div className="mt-2 text-sm">
                      <span className="text-xs font-medium text-muted-foreground">改进版：</span>
                      {evaluation.improved_version}
                    </div>
                  )}
                  {evaluation.example_sentence && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      📝 更多例句：{evaluation.example_sentence}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={generateExercises} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                生成中…
              </>
            ) : (
              <>
                <PenLine className="mr-2 size-4" />
                生成练习题
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ─── 主页面 ───

export function MnemonicPage() {
  const { entryId } = useParams<{ entryId: string }>()
  const navigate = useNavigate()
  const { ready } = useStore(vocabStore)

  const [entry, setEntry] = useState<VocabEntry | null>(null)
  const [card, setCard] = useState<MnemonicCard | null>(null)
  const [partialCard, setPartialCard] = useState<Partial<MnemonicCard>>({})
  const [streaming, setStreaming] = useState(false)
  const [association, setAssociation] = useState<Association | undefined>()
  const [exercises, setExercises] = useState<Exercises | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 流式生成卡片
  const streamCard = useCallback(async (found: VocabEntry) => {
    setStreaming(true)
    setPartialCard({})
    setCard(null)
    setError(null)

    try {
      const gen = services.mnemonic.generateCardStream(found.text, found.context, found.note)
      let lastCard: MnemonicCard | null = null

      for await (const event of gen) {
        if (event.event === 'field') {
          setPartialCard(prev => ({ ...prev, [event.data.field]: event.data.value }))
        } else if (event.event === 'done') {
          lastCard = event.data.card
          setCard(event.data.card)
          await saveMnemonic({
            id: found.id,
            card: event.data.card,
            createdAt: Date.now(),
          })
        } else if (event.event === 'error') {
          setError(event.data.error)
        }
      }

      // 如果流结束但没有 done 事件，用 partialCard 兜底
      if (!lastCard) {
        const fallback = partialCard as MnemonicCard
        if (fallback.core_meaning && fallback.phonetic_mnemonic) {
          setCard(fallback)
          await saveMnemonic({
            id: found.id,
            card: fallback,
            createdAt: Date.now(),
          })
        }
      }
    } catch (err) {
      setError('生成失败，请重试')
    } finally {
      setStreaming(false)
      setLoading(false)
    }
  }, [])

  // 初始化：加载词条 + 缓存/生成卡片
  useEffect(() => {
    let cancelled = false

    async function init() {
      await initVocab()
      if (cancelled || !entryId) return

      // 查找词条
      const { entries } = vocabStore.get()
      const found = entries.find((e) => e.id === entryId)
      if (!found) {
        setError('词条不存在')
        setLoading(false)
        return
      }
      setEntry(found)

      // 检查缓存
      const cached = await loadMnemonic(entryId)
      if (cancelled) return

      if (cached) {
        setCard(cached.card)
        setAssociation(cached.association)
        setExercises(cached.exercises)
        setLoading(false)
      } else {
        // 流式生成卡片
        await streamCard(found)
      }
    }

    init()
    return () => { cancelled = true }
  }, [entryId, streamCard])

  const handleRefresh = useCallback(async () => {
    if (!entryId || !entry) return
    setLoading(true)
    setError(null)
    setAssociation(undefined)
    setExercises(undefined)

    try {
      await clearMnemonic(entryId)
      await streamCard(entry)
    } catch {
      setError('生成失败，请重试')
      setLoading(false)
    }
  }, [entryId, entry, streamCard])

  // 当前显示的卡片：完整 card 优先，否则用 partialCard
  const displayCard = card ?? (streaming && Object.keys(partialCard).length > 0 ? partialCard as Partial<MnemonicCard> : null)

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            <span className="text-sm">返回</span>
          </button>
          <div className="h-4 w-px bg-border" />
          {entry && displayCard && (
            <>
              <h1 className="font-serif text-lg font-semibold">{entry.text}</h1>
              {displayCard.phonetic_mnemonic && (
                <span className="font-mono text-sm text-muted-foreground">
                  {typeof displayCard.phonetic_mnemonic.syllables === 'string'
                    ? displayCard.phonetic_mnemonic.syllables.split(' ').slice(-1)[0]
                    : String(displayCard.phonetic_mnemonic.syllables ?? '')}
                </span>
              )}
              {displayCard.difficulty && (
                <Badge variant={difficultyLabel[displayCard.difficulty]?.variant ?? 'default'}>
                  {difficultyLabel[displayCard.difficulty]?.text ?? displayCard.difficulty}
                </Badge>
              )}
              <div className="flex-1" />
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={loading || streaming}>
                <RotateCcw className="mr-1 size-3.5" />
                刷新
              </Button>
            </>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {loading && !displayCard && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <div className="mt-4 text-sm text-muted-foreground">正在生成助记卡片…</div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="text-sm text-destructive">{error}</div>
            <Button variant="outline" size="sm" className="mt-4" onClick={handleRefresh}>
              <RefreshCw className="mr-2 size-4" />
              重试
            </Button>
          </div>
        )}

        {displayCard && entry && (
          <div className="space-y-4">
            <CoreMeaningCard data={displayCard.core_meaning} />
            <PhoneticCard data={displayCard.phonetic_mnemonic} />
            <WordRootsCard data={displayCard.word_roots} />
            <ExamplesCard data={displayCard.examples} />
            <CollocationsCard data={displayCard.collocations} />

            {/* 流式生成中显示进度指示 */}
            {streaming && !card && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span>正在生成更多内容…</span>
              </div>
            )}

            {card && (
              <>
                <AssociationCard
                  entryId={entry.id}
                  word={entry.text}
                  meaning={card.core_meaning.primary}
                  initial={association}
                  autoLoad={card.difficulty === 'hard' && !association}
                />

                <ExercisesSection
                  entryId={entry.id}
                  word={entry.text}
                  meaning={card.core_meaning.primary}
                  collocations={Array.isArray(card.collocations) ? card.collocations.map((c) => c.phrase) : []}
                  difficulty={card.difficulty}
                  initial={exercises}
                />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
