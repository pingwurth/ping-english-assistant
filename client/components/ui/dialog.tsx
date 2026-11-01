import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

/**
 * 打开后该时长内的 overlay 点击不触发关闭：
 * 双击"打开按钮"时，第二次点击会落在 overlay 上按钮原位置（弹窗卡片居中，按钮多在其外），
 * 瞬间关掉刚打开的弹窗，表现为"点击没反应"。
 */
const OUTSIDE_CLICK_GRACE_MS = 300

/**
 * 嵌套 Dialog 治理（模块级打开栈）：
 *  - 滚动锁只在最外层 Dialog 关闭时恢复 —— 内层卸载若直接清空 overflow，
 *    外层还开着页面就恢复滚动了；
 *  - Escape 只交给栈顶（最后打开者）处理 —— 各实例独立监听时一次 Esc 会同关
 *    多层，丢掉正在内层填写的表单。
 * 每个打开的实例占一个槽位（token），关闭/卸载时按槽位移除，重渲染不乱序。
 */
const dialogStack: Array<() => void> = []
let escapeListenerOn = false
function syncEscapeListener() {
  if (dialogStack.length > 0 && !escapeListenerOn) {
    document.addEventListener('keydown', onGlobalEscape)
    escapeListenerOn = true
  } else if (dialogStack.length === 0 && escapeListenerOn) {
    document.removeEventListener('keydown', onGlobalEscape)
    escapeListenerOn = false
  }
}
function onGlobalEscape(e: KeyboardEvent) {
  if (e.key === 'Escape') dialogStack[dialogStack.length - 1]?.()
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const openedAtRef = useRef(0)
  /** 本实例在栈中的槽位（-1 = 未压栈）；重渲染用同一槽位刷新回调 */
  const slotRef = useRef(-1)

  useEffect(() => {
    if (!open) return
    openedAtRef.current = Date.now()
    // 压栈/刷新：onOpenChange 可能是每次渲染新建的内联函数，槽位内容跟随最新值
    const close = () => onOpenChange(false)
    if (slotRef.current >= 0 && slotRef.current < dialogStack.length) dialogStack[slotRef.current] = close
    else { dialogStack.push(close); slotRef.current = dialogStack.length - 1 }
    // 滚动锁只在首个 Dialog 打开时上锁
    if (dialogStack.length === 1) document.body.style.overflow = 'hidden'
    syncEscapeListener()
    return () => {
      if (slotRef.current >= 0) dialogStack.splice(slotRef.current, 1)
      slotRef.current = -1
      // 栈空（最后一个 Dialog 关闭/卸载）才恢复页面滚动
      if (dialogStack.length === 0) document.body.style.overflow = ''
      syncEscapeListener()
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      data-dialog
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (Date.now() - openedAtRef.current < OUTSIDE_CLICK_GRACE_MS) return
        if (e.target === overlayRef.current) onOpenChange(false)
      }}
    >
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl bg-card shadow-xl">
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 z-10 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="关闭"
        >
          <X className="size-5" />
        </button>
        {children}
      </div>
    </div>
  )
}

function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b p-6 pb-4">{children}</div>
}

function DialogTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold ${className ?? ''}`}>{children}</h2>
}

function DialogDescription({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-muted-foreground">{children}</p>
}

function DialogContent({ children }: { children: React.ReactNode }) {
  return <div className="p-6">{children}</div>
}

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogContent }
