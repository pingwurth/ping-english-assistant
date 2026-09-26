import type { TranslateDirection } from '@/types/api'

interface TranslateDirectionToggleProps {
  value: TranslateDirection
  onChange: (direction: TranslateDirection) => void
  disabled?: boolean
}

/** 方向选项（顺序即展示顺序） */
const OPTIONS: { value: TranslateDirection; label: string }[] = [
  { value: 'en2zh', label: '英 → 中' },
  { value: 'zh2en', label: '中 → 英' },
]

/**
 * 中英互译方向切换（英→中 / 中→英）。
 * 单句翻译（字幕编辑弹窗）与整篇翻译（抽屉）共用，默认方向由各自入口自动检测后传入。
 */
export function TranslateDirectionToggle({ value, onChange, disabled }: TranslateDirectionToggleProps) {
  return (
    <div className="flex shrink-0 rounded-lg border bg-background p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          disabled={disabled}
          aria-pressed={value === o.value}
          className={`rounded-md px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${value === o.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}