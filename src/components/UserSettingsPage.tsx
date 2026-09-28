import type { ReactNode } from 'react'

import { useUserSettings } from '@/store/userSettings'
import { ACCENTS, PALETTES, getAccent, getPalette } from '@/theme'
import type { SupabaseUser } from '@/lib/supabase'

interface UserSettingsPageProps {
  user: SupabaseUser
  onClose: () => void
}

interface RowProps {
  label: string
  hint?: string
  children: ReactNode
}

/**
 * Every control calls a setter; the store repaints the document root at once
 * and debounces the matching `POST /user_settings` upsert, so nothing here
 * talks to Supabase directly.
 */
export function UserSettingsPage({ user, onClose }: UserSettingsPageProps) {
  const settings = useUserSettings((s) => s.settings)
  const loaded = useUserSettings((s) => s.loaded)
  const setTheme = useUserSettings((s) => s.setTheme)
  const setPalette = useUserSettings((s) => s.setPalette)
  const setAccent = useUserSettings((s) => s.setAccent)
  const setCardRadius = useUserSettings((s) => s.setCardRadius)
  const setReduceMotion = useUserSettings((s) => s.setReduceMotion)
  const setDefaultSnapToGrid = useUserSettings((s) => s.setDefaultSnapToGrid)
  const setDefaultGridPattern = useUserSettings((s) => s.setDefaultGridPattern)
  const setDefaultGridSize = useUserSettings((s) => s.setDefaultGridSize)

  const avatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture
  const accent = getAccent(settings.accent)

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <aside
        className="cc-scroll flex h-full w-[clamp(20rem,28vw,26rem)] flex-col overflow-y-auto border-l border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="User settings"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {avatar ? (
            <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-[var(--cc-on-brand)]">
              {user.email.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">{user.user_metadata?.name ?? user.email}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button type="button" className="cc-icon" onClick={onClose} aria-label="Close settings">
            <span aria-hidden>✕</span>
          </button>
        </div>

        {!loaded ? (
          <p className="p-4 text-sm text-muted">Loading your settings…</p>
        ) : (
          <div className="flex-1 space-y-7 p-4">
            {/* ---------------------------------------------------------- */}
            {/* Appearance                                                  */}
            {/* ---------------------------------------------------------- */}
            <Section title="Appearance">
              <Row label="Theme">
                <div className="cc-seg">
                  <button type="button" data-active={settings.theme === 'light'} onClick={() => setTheme('light')}>
                    Light
                  </button>
                  <button type="button" data-active={settings.theme === 'dark'} onClick={() => setTheme('dark')}>
                    Dark
                  </button>
                </div>
              </Row>

              <Row label="Palette" hint="The neutrals. Works in both light and dark.">
                <div className="grid grid-cols-2 gap-1.5">
                  {PALETTES.map((option) => {
                    const swatches = [option.light.surface, option.light.canvas, option.light.ink]
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className="rounded-lg border p-2 text-left transition"
                        data-active={settings.palette === option.id}
                        aria-pressed={settings.palette === option.id}
                        onClick={() => setPalette(option.id)}
                      >
                        <span className="mb-1.5 flex overflow-hidden rounded">
                          {swatches.map((colour, index) => (
                            <span
                              key={index}
                              className="h-4 flex-1"
                              style={{ background: colour ?? 'var(--cc-surface)' }}
                            />
                          ))}
                        </span>
                        <span className="block text-[12px] font-semibold text-ink">
                          {option.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  {getPalette(settings.palette).hint}
                </p>
              </Row>

              <Row label="Accent" hint="Buttons, focus rings, links and selection">
                <div className="flex flex-wrap gap-1.5">
                  {ACCENTS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="h-7 w-7 rounded-full transition"
                      style={{
                        background: option.base,
                        boxShadow:
                          settings.accent === option.id
                            ? `0 0 0 2px var(--cc-surface), 0 0 0 4px ${option.base}`
                            : 'none',
                      }}
                      title={option.label}
                      aria-label={option.label}
                      aria-pressed={settings.accent === option.id}
                      onClick={() => setAccent(option.id)}
                    />
                  ))}
                </div>
              </Row>

              <Row label="Card corner radius" hint={`${settings.cardRadius}px`}>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={2}
                  value={settings.cardRadius}
                  onChange={(e) => setCardRadius(Number(e.target.value))}
                  className="w-full accent-[var(--cc-brand)]"
                  aria-label="Card corner radius"
                />
              </Row>

              <Row label="Reduce motion" hint="Turns off panel and toast animation">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="accent-[var(--cc-brand)]"
                    checked={settings.reduceMotion}
                    onChange={(e) => setReduceMotion(e.target.checked)}
                  />
                  Animate panels
                </label>
              </Row>
            </Section>

            {/* ---------------------------------------------------------- */}
            {/* Canvas defaults                                             */}
            {/* ---------------------------------------------------------- */}
            <Section title="Canvas defaults">
              <Row label="Snap to grid">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="accent-[var(--cc-brand)]"
                    checked={settings.defaultSnapToGrid}
                    onChange={(e) => setDefaultSnapToGrid(e.target.checked)}
                  />
                  New pages start snapped
                </label>
              </Row>

              <Row label="Grid pattern">
                <div className="cc-seg">
                  <button
                    type="button"
                    data-active={settings.defaultGridPattern === 'none'}
                    onClick={() => setDefaultGridPattern('none')}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    data-active={settings.defaultGridPattern === 'dots'}
                    onClick={() => setDefaultGridPattern('dots')}
                  >
                    Dots
                  </button>
                  <button
                    type="button"
                    data-active={settings.defaultGridPattern === 'lines'}
                    onClick={() => setDefaultGridPattern('lines')}
                  >
                    Lines
                  </button>
                </div>
              </Row>

              <Row label="Grid size" hint={`${settings.defaultGridSize}px`}>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={2}
                  value={settings.defaultGridSize}
                  onChange={(e) => setDefaultGridSize(Number(e.target.value))}
                  className="w-full accent-[var(--cc-brand)]"
                  aria-label="Grid size"
                />
              </Row>
            </Section>

            {/* ---------------------------------------------------------- */}
            {/* Preview                                                     */}
            {/* ---------------------------------------------------------- */}
            <Section title="Preview">
              <div
                className="rounded-xl border border-line p-3"
                style={{ borderRadius: settings.cardRadius }}
              >
                <div
                  className="mb-2 px-2 py-1 text-xs font-bold"
                  style={{
                    borderRadius: Math.max(2, settings.cardRadius - 6),
                    background: `color-mix(in srgb, ${accent.base} 14%, var(--cc-surface))`,
                  }}
                >
                  {getPalette(settings.palette).label} · {settings.theme} · {accent.label}
                </div>
                <p className="text-[13px] text-muted">
                  Cards and links use the colours you pick for them. Everything else follows the
                  theme.
                </p>
              </div>
            </Section>
          </div>
        )}

        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Changes apply immediately and are saved to your account.
        </p>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="cc-label">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: RowProps) {
  return (
    <div>
      <div className="mb-1.5 block text-sm font-semibold text-ink">{label}</div>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
