/**
 * 生词本管理页面 —— 左侧生词本列表 + 右侧词条列表
 *
 * 路由：/vocabulary
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStore } from '@/stores/store'
import { vocabStore, initVocab, createBook, removeBook, removeEntry } from '@/stores/vocab-store'
import { DEFAULT_BOOK_ID } from '@/types/vocabulary'
import type { VocabBook, VocabEntry } from '@/types/vocabulary'

function formatDate(ts: number): string {
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function EntryItem({ entry, onDelete }: { entry: VocabEntry; onDelete: () => void }) {
  const freq = entry.frequency ?? 0
  const [confirming, setConfirming] = useState(false)

  const handleDelete = () => {
    if (confirming) {
      onDelete()
      setConfirming(false)
    } else {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
    }
  }

  return (
    <div className="group flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <div className="font-serif text-base font-semibold">{entry.text}</div>
        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.context}</div>
        <div className="mt-2 flex items-center gap-2">
          {freq > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              出现 {freq} 次
            </span>
          )}
          <span className="text-xs text-muted-foreground">{formatDate(entry.addedAt)}</span>
        </div>
      </div>
      <button
        className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
          confirming
            ? 'bg-destructive/10 text-destructive'
            : 'text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100'
        }`}
        onClick={handleDelete}
        title={confirming ? '确认删除' : '删除'}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

export function Vocabulary() {
  const { books, entries, ready } = useStore(vocabStore)
  const [selectedBookId, setSelectedBookId] = useState<string>(DEFAULT_BOOK_ID)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'addedAt' | 'frequency'>('addedAt')
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newBookName, setNewBookName] = useState('')

  useEffect(() => { initVocab() }, [])

  // 确保选中的 bookId 存在
  useEffect(() => {
    if (ready && books.length > 0 && !books.find((b) => b.id === selectedBookId)) {
      setSelectedBookId(books[0].id)
    }
  }, [ready, books, selectedBookId])

  const selectedBook = books.find((b) => b.id === selectedBookId)
  const bookEntries = entries.filter((e) => e.bookId === selectedBookId)
  const filteredEntries = search
    ? bookEntries.filter((e) => e.text.toLowerCase().includes(search.toLowerCase()))
    : bookEntries

  const sortedEntries = useMemo(() => {
    const arr = [...filteredEntries]
    if (sortBy === 'frequency') {
      arr.sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0) || b.addedAt - a.addedAt)
    } else {
      arr.sort((a, b) => b.addedAt - a.addedAt)
    }
    return arr
  }, [filteredEntries, sortBy])

  const handleCreateBook = async () => {
    if (!newBookName.trim()) return
    const book = await createBook(newBookName.trim())
    setSelectedBookId(book.id)
    setNewBookName('')
    setShowCreateInput(false)
  }

  const handleRemoveBook = async (bookId: string) => {
    if (bookId === DEFAULT_BOOK_ID) return
    await removeBook(bookId)
    if (selectedBookId === bookId) {
      setSelectedBookId(DEFAULT_BOOK_ID)
    }
  }

  const handleRemoveEntry = async (entryId: string) => {
    await removeEntry(entryId)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />
            <span className="text-sm">返回</span>
          </Link>
          <div className="h-4 w-px bg-border" />
          <h1 className="font-serif text-lg font-semibold">生词本</h1>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 gap-0">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r bg-muted/30 py-4">
          <div className="mb-3 px-4 text-xs font-medium text-muted-foreground">生词本</div>
          <div className="space-y-0.5 px-2">
            {books.map((book) => (
              <div
                key={book.id}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                  selectedBookId === book.id
                    ? 'bg-background shadow-sm'
                    : 'hover:bg-background/50'
                }`}
                onClick={() => setSelectedBookId(book.id)}
              >
                <span className={`text-sm ${selectedBookId === book.id ? 'font-semibold text-primary' : ''}`}>
                  {book.name}
                </span>
                <div className="flex items-center gap-1">
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {entries.filter((e) => e.bookId === book.id).length}
                  </span>
                  {book.id !== DEFAULT_BOOK_ID && (
                    <button
                      className="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); handleRemoveBook(book.id) }}
                      title="删除生词本"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {showCreateInput ? (
            <div className="mt-2 px-4">
              <Input
                placeholder="生词本名称"
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateBook()
                  if (e.key === 'Escape') { setShowCreateInput(false); setNewBookName('') }
                }}
                onBlur={() => { if (!newBookName.trim()) setShowCreateInput(false) }}
                className="h-8 text-sm"
              />
            </div>
          ) : (
            <button
              className="mt-2 flex w-full items-center gap-2 px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setShowCreateInput(true)}
            >
              <Plus className="size-3.5" />
              新建生词本
            </button>
          )}
        </aside>

        {/* Main */}
        <section className="flex min-w-0 flex-1 flex-col">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h2 className="font-serif text-xl font-semibold">{selectedBook?.name ?? '生词本'}</h2>
              <span className="text-sm text-muted-foreground">{bookEntries.length} 个词条</span>
            </div>
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-3 border-b px-6 py-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
              <Search className="size-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索单词或词组…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex shrink-0 items-center rounded-lg bg-muted/50 p-0.5">
              <button
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  sortBy === 'addedAt' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSortBy('addedAt')}
              >
                添加时间
              </button>
              <button
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  sortBy === 'frequency' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setSortBy('frequency')}
              >
                出现频率
              </button>
            </div>
          </div>

          {/* Entry list */}
          <div className="flex-1 overflow-auto px-4 py-2">
            {sortedEntries.length > 0 ? (
              <div className="divide-y">
                {sortedEntries.map((entry) => (
                  <EntryItem
                    key={entry.id}
                    entry={entry}
                    onDelete={() => handleRemoveEntry(entry.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <BookOpen className="mb-4 size-12 text-muted-foreground/50" />
                <div className="text-sm font-medium text-muted-foreground">
                  {search ? '没有匹配的词条' : '还没有收录任何单词'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground/70">
                  {search ? '尝试其他关键词' : '在播放器的字幕区域选中英文文本，即可添加到这个生词本'}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
