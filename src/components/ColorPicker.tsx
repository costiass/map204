import { normalizeColor } from '@/utils/filters'

interface ColorPickerProps {
  value: string
  colors: string[]
  onChange: (color: string) => void
  label?: string
  columns?: number
}

/** Preset swatches plus a native colour input for anything custom. */
export function ColorPicker({ value, colors, onChange, label, columns = 6 }: ColorPickerProps) {
  const active = normalizeColor(value)
  return (
    <div>
      {label ? <span className="cc-label">{label}</span> : null}
      <div className="cc-swatches" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className="cc-swatch"
            title={color}
            style={{ background: color }}
            data-active={active === normalizeColor(color) ? 'true' : undefined}
            onClick={() => onChange(color)}
          />
        ))}
        <label className="cc-swatch relative overflow-hidden" title="Custom colour" style={{ background: value }}>
          <span
            aria-hidden="true"
            className="absolute inset-0 grid place-items-center text-[13px] font-bold text-white"
            style={{ textShadow: '0 1px 2px rgba(0,0,0,.5)' }}
          >
            +
          </span>
          <input
            type="color"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => onChange(event.target.value.toUpperCase())}
          />
        </label>
      </div>
    </div>
  )
}
