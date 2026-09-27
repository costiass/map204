import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'

interface UserSettingsPageProps {
  user: SupabaseUser
  onClose: () => void
}

export function UserSettingsPage({ user, onClose }: UserSettingsPageProps) {
  const { settings, setTheme, setDefaultSnapToGrid, setDefaultGridPattern, setDefaultGridSize } = useUserSettings()

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <aside
        className="flex h-full w-[clamp(30%,36vw,50%)] flex-col border-l border-line bg-white shadow-lg dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          {user.user_metadata?.avatar_url || user.user_metadata?.picture ? (
            <img
              src={user.user_metadata.avatar_url ?? user.user_metadata.picture}
              alt="Profile"
              className="h-8 w-8 rounded-full object-cover"
            />
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
          <button
            type="button"
            className="cc-btn px-1.5 py-1"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500">
            Settings
          </h2>

          <div className="space-y-6">
            {/* Theme */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Theme
              </label>
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
            </div>

            {/* Default snap to grid */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Default snap to grid
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="accent-indigo-500"
                  checked={settings.defaultSnapToGrid}
                  onChange={(e) => setDefaultSnapToGrid(e.target.checked)}
                />
                New pages start with snap to grid enabled
              </label>
            </div>

            {/* Default grid pattern */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Default grid pattern
              </label>
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
            </div>

            {/* Default grid size */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Default grid size: {settings.defaultGridSize}px
              </label>
              <input
                type="range"
                min={10}
                max={50}
                step={2}
                value={settings.defaultGridSize}
                onChange={(e) => setDefaultGridSize(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
