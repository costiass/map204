import type { ReactNode } from 'react'

import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'

interface UserSettingsPageProps {
  user: SupabaseUser
  onClose: () => void
}

interface RowProps {
  label: string
  children: ReactNode
}

/**
 * Every control calls a setter; the store debounces the matching
 * `POST /user_settings` upsert, so nothing here talks to Supabase directly.
 */
export function UserSettingsPage({ user, onClose }: UserSettingsPageProps) {
  const settings = useUserSettings((s) => s.settings)
  const loaded = useUserSettings((s) => s.loaded)
  const setTheme = useUserSettings((s) => s.setTheme)
  const setDefaultSnapToGrid = useUserSettings((s) => s.setDefaultSnapToGrid)
  const setDefaultGridPattern = useUserSettings((s) => s.setDefaultGridPattern)
  const setDefaultGridSize = useUserSettings((s) => s.setDefaultGridSize)

  const avatar = user.user_metadata?.avatar_url ?? user.user_metadata?.picture

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <aside
        className="flex h-full w-[clamp(30%,36vw,50%)] flex-col border-l border-line bg-white shadow-lg dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="User settings"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {avatar ? (
            <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
              {user.email.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">
              {user.user_metadata?.name ?? user.email}
            </p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <button type="button" className="cc-btn px-1.5 py-1" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500">
            Settings
          </h2>

          {!loaded ? (
            <p className="text-sm text-slate-400">Loading your settings…</p>
          ) : (
            <div className="space-y-6">
              <Row label="Theme">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cc-btn"
                    data-active={settings.theme === 'light'}
                    onClick={() => setTheme('light')}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    className="cc-btn"
                    data-active={settings.theme === 'dark'}
                    onClick={() => setTheme('dark')}
                  >
                    Dark
                  </button>
                </div>
              </Row>

              <Row label="Default snap to grid">
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    checked={settings.defaultSnapToGrid}
                    onChange={(event) => setDefaultSnapToGrid(event.target.checked)}
                  />
                  New pages start with snap to grid enabled
                </label>
              </Row>

              <Row label="Default grid pattern">
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

              <Row label={`Default grid size: ${settings.defaultGridSize}px`}>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={2}
                  value={settings.defaultGridSize}
                  onChange={(event) => setDefaultGridSize(Number(event.target.value))}
                  className="w-full accent-indigo-500"
                />
              </Row>
            </div>
          )}
        </div>

        <p className="border-t border-line px-4 py-3 text-xs text-slate-400">
          Changes are saved to your account as you make them.
        </p>
      </aside>
    </div>
  )
}

function Row({ label, children }: RowProps) {
  return (
    <div>
      <div className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </div>
      {children}
    </div>
  )
}
