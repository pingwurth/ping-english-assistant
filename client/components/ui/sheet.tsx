import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  /** 抽屉宽度百分比，默认 45 */
  widthPercent?: number
}

function Sheet({ open, onOpenChange, children, widthPercent = 45 }: SheetProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleEscape)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onOpenChange(false) }}
    >
      <div
        className="relative flex h-full flex-col bg-card shadow-xl max-md:w-full"
        style={{ width: `${widthPercent}%` }}
      >
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

function SheetHeader({ children }: { children: React.ReactNode }) {
  return <div className="border-b p-6 pb-4">{children}</div>
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>
}

function SheetDescription({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-muted-foreground">{children}</p>
}

function SheetContent({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 overflow-auto p-6">{children}</div>
}

function SheetFooter({ children }: { children: React.ReactNode }) {
  return <div className="border-t p-6 pt-4">{children}</div>
}

export { Sheet, SheetHeader, SheetTitle, SheetDescription, SheetContent, SheetFooter }
