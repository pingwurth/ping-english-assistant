'use client'

/**
 * 零依赖手写开关组件（项目惯例：ui 组件不引 radix）。
 * 语义：button + role="switch" + aria-checked，圆点平移过渡。
 */

import { cn } from '@/lib/utils'

interface SwitchProps {
  /** 当前选中状态 */
  checked: boolean
  /** 状态变更回调 */
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  'aria-label'?: string
  /** 透传外层 className */
  className?: string
}

export function Switch({ checked, onCheckedChange, disabled, className, ...rest }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:pointer-events-none disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}
