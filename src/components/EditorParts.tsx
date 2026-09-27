import { useState } from 'react'
import type { ReactNode } from 'react'

import { clamp } from '@/utils/geometry'

/** A titled group of controls inside the inspector. */
export function Section({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="border-b border-line px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="cc-label mb-0">{title}</h3>
        <span className="ml-auto" />
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * Numeric input that stays uncontrolled and remounts when the committed value
 * changes, so a rejected entry can be reverted without mirroring the prop.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  step = 1,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onCommit: (value: number) => void
  step?: number
}) {
  const [resetKey, setResetKey] = useState(0)

  return (
    <label className="block">
      <span className="cc-label">{label}</span>
      <input
        key={`${value}-${resetKey}`}
        className="cc-input tabular-nums"
        inputMode="numeric"
        defaultValue={String(Math.round(value))}
        onBlur={(event) => {
          const raw = event.target.value.trim()
          const parsed = Number(raw)
          if (raw === '' || !Number.isFinite(parsed)) {
            setResetKey((current) => current + 1)
            return
          }
          const bounded = clamp(parsed, min ?? -Infinity, max ?? Infinity)
          onCommit(step === 1 ? Math.round(bounded) : bounded)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

/** Range slider with a live value readout. */
export function SliderField({
  label,
  value,
  min,
  max,
  suffix = '',
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix?: string
  onChange: (value: number) => void
  onCommit?: (value: number) => void
}) {
  return (
    <label className="block">
      <span className="cc-label">
        {label} {value}
        {suffix}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        className="w-full accent-indigo-500"
        onChange={(event) => onChange(clamp(Number(event.target.value), min, max))}
        onPointerUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
        onKeyUp={(event) => onCommit?.(Number((event.target as HTMLInputElement).value))}
      />
    </label>
  )
}
