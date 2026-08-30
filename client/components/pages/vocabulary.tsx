/**
 * 生词本管理页面 —— 左侧生词本列表 + 右侧词条列表
 *
 * 路由：/vocabulary
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/stores/store'
import { vocabStore, initVocab, createBook, removeBook, removeEntry, updateEntry, addEntry } from '@/stores/vocab-store'
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

function EntryItem({ entry, onDelete, onClick }: { entry: VocabEntry; onDelete: () => void; onClick: () => void }) {
  const freq = entry.frequency ?? 0
  const [confirming, setConfirming] = useState(false)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirming) {
      onDelete()
      setConfirming(false)
    } else {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
    }
  }

  return (
    <div className="group flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-muted/50 cursor-pointer" onClick={onClick}>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-base font-semibold">{entry.text}</div>
        <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.context}</div>
        {entry.note && (
          <div className="mt-1 line-clamp-1 text-xs text-primary/80">📝 {entry.note}</div>
        )}
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
  const navigate = useNavigate()
  const { books, entries, ready } = useStore(vocabStore)
  const [selectedBookId, setSelectedBookId] = useState<string>(DEFAULT_BOOK_ID)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'addedAt' | 'frequency'>('addedAt')
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newBookName, setNewBookName] = useState('')
  const [selectedEntry, setSelectedEntry] = useState<VocabEntry | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState('')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ text: '', context: '', note: '' })

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

  const handleAddWord = async () => {
    if (!addForm.text.trim()) return
    await addEntry({
      text: addForm.text.trim(),
      context: addForm.context.trim() || addForm.text.trim(),
      materialId: '',
      sentenceIndex: -1,
      bookId: selectedBookId,
      note: addForm.note.trim() || undefined,
    })
    setAddForm({ text: '', context: '', note: '' })
    setShowAddDialog(false)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" />
            <span className="text-sm">返回</span>
          </button>
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
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-1 size-4" />
              添加生词
            </Button>
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
                    onClick={() => setSelectedEntry(entry)}
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

      {/* Entry detail dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) { setSelectedEntry(null); setEditingNote(false) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{selectedEntry?.text}</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">所在句子</div>
                <div className="mt-1 text-sm">{selectedEntry.context}</div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">笔记</div>
                  {!editingNote && (
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => { setEditingNote(true); setNoteValue(selectedEntry.note ?? '') }}
                    >
                      <Pencil className="size-3" />
                      {selectedEntry.note ? '编辑' : '添加'}
                    </button>
                  )}
                </div>
                {editingNote ? (
                  <div className="mt-1 space-y-2">
                    <Textarea
                      value={noteValue}
                      onChange={(e) => setNoteValue(e.target.value)}
                      rows={3}
                      className="text-sm"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingNote(false)}
                      >
                        取消
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          await updateEntry(selectedEntry.id, { note: noteValue.trim() || undefined })
                          setSelectedEntry({ ...selectedEntry, note: noteValue.trim() || undefined })
                          setEditingNote(false)
                        }}
                      >
                        保存
                      </Button>
                    </div>
                  </div>
                ) : (
                  selectedEntry.note && (
                    <div className="mt-1 whitespace-pre-wrap text-sm">{selectedEntry.note}</div>
                  )
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {selectedEntry.frequency > 0 && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                    出现 {selectedEntry.frequency} 次
                  </span>
                )}
                <span>添加于 {formatDate(selectedEntry.addedAt)}</span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  const id = selectedEntry.id
                  setSelectedEntry(null)
                  navigate(`/vocabulary/mnemonic/${id}`)
                }}
              >
                <Sparkles className="mr-2 size-4" />
                生词助记
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add word dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { if (!open) setShowAddDialog(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加生词</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">单词或词组 *</div>
              <Input
                placeholder="输入单词或词组…"
                value={addForm.text}
                onChange={(e) => setAddForm({ ...addForm, text: e.target.value })}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && addForm.text.trim()) handleAddWord() }}
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">所在句子（可选）</div>
              <Textarea
                placeholder="输入例句或上下文…"
                value={addForm.context}
                onChange={(e) => setAddForm({ ...addForm, context: e.target.value })}
                rows={2}
                className="text-sm"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">笔记（可选）</div>
              <Textarea
                placeholder="添加你的笔记…"
                value={addForm.note}
                onChange={(e) => setAddForm({ ...addForm, note: e.target.value })}
                rows={2}
                className="text-sm"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>取消</Button>
            <Button onClick={handleAddWord} disabled={!addForm.text.trim()}>添加</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
