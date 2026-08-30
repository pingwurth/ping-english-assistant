/**
 * 生词本选择弹窗 —— 选择目标生词本或创建新本
 *
 * 使用项目内 Dialog 组件。支持：
 * - radio 选择已有生词本
 * - 内联新建生词本
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/stores/store'
import { vocabStore, createBook, addEntry } from '@/stores/vocab-store'

interface VocabBookPickerProps {
  /** 选中的文本 */
  selectedText: string
  /** 所在句子原文 */
  sentenceTextEn: string
  /** 句子索引 */
  sentenceIndex: number
  /** 来源素材 ID */
  materialId: string
  /** 关闭弹窗 */
  onClose: () => void
  /** 添加成功回调，参数为生词本名称 */
  onAdded: (bookName: string) => void
}

export function VocabBookPicker({ selectedText, sentenceTextEn, sentenceIndex, materialId, onClose, onAdded }: VocabBookPickerProps) {
  const { books } = useStore(vocabStore)
  const [selectedBookId, setSelectedBookId] = useState<string>(books[0]?.id ?? 'default')
  const [showCreate, setShowCreate] = useState(false)
  const [newBookName, setNewBookName] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      let targetBookId = selectedBookId
      let targetBookName = books.find((b) => b.id === selectedBookId)?.name ?? '默认生词本'

      // 如果正在新建生词本
      if (showCreate && newBookName.trim()) {
        const newBook = await createBook(newBookName.trim())
        targetBookId = newBook.id
        targetBookName = newBook.name
      }

      await addEntry({
        text: selectedText,
        context: sentenceTextEn,
        materialId,
        sentenceIndex,
        bookId: targetBookId,
        note: note.trim() || undefined,
      })

      onAdded(targetBookName)
    } catch (e) {
      console.error('[VocabBookPicker] add entry failed:', e)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateToggle = () => {
    setShowCreate(!showCreate)
    if (!showCreate) setNewBookName('')
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加到生词本</DialogTitle>
          <DialogDescription>选择要添加到的生词本</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium text-muted-foreground">添加生词</div>
            <div className="mt-1 font-serif text-base font-semibold">{selectedText}</div>
            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{sentenceTextEn}</div>
          </div>

          <div className="text-xs font-medium text-muted-foreground">选择生词本</div>

          <div className="space-y-1.5">
            {books.map((book) => (
              <label
                key={book.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  selectedBookId === book.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                }`}
              >
                <input
                  type="radio"
                  name="vocab-book"
                  value={book.id}
                  checked={selectedBookId === book.id}
                  onChange={() => setSelectedBookId(book.id)}
                  className="size-4 accent-primary"
                />
                <span className="flex-1 text-sm font-medium">{book.name}</span>
              </label>
            ))}
          </div>

          {showCreate ? (
            <div className="rounded-lg border border-primary bg-primary/5 p-3">
              <div className="mb-2 text-xs font-medium text-primary">新建生词本</div>
              <Input
                placeholder="输入生词本名称…"
                value={newBookName}
                onChange={(e) => setNewBookName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' && newBookName.trim()) handleConfirm() }}
                onBlur={() => { if (!newBookName.trim()) setShowCreate(false) }}
              />
            </div>
          ) : (
            <button
              className="flex w-full items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              onClick={handleCreateToggle}
            >
              <Plus className="size-4" />
              新建生词本
            </button>
          )}

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">笔记（可选）</div>
            <Textarea
              placeholder="添加你的笔记…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={handleConfirm} disabled={submitting || (showCreate && !newBookName.trim())}>
            {submitting ? '添加中…' : '确定添加'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
