import { useUserSettings } from '@/store/userSettings'
import type { SupabaseUser } from '@/lib/supabase'

interface UserSettingsPageProps {
  user: SupabaseUser
  onBack: () => void
}

export function UserSettingsPage({ user, onBack }: UserSettingsPageProps) {
  const { settings, setTheme, setDefaultSnapToGrid, setDefaultGridPattern, setDefaultGridSize } = useUserSettings()

  return (
    <div className="flex h-full w-full flex-col items-center bg-canvas p-8">
      <div className="w-full max-w-lg">
        <button
          type="button"
          className="mb-6 cursor-pointer text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          onClick={onBack}
        >
          ← Back
        </button>

        <h1 className="mb-6 text-2xl font-bold text-slate-800 dark:text-slate-100">User Settings</h1>

        <div className="space-y-6 rounded-xl border border-line bg-white p-6 dark:bg-slate-800">
          {/* Profile section */}
          <div className="flex items-center gap-4 border-b border-line pb-4 dark:border-slate-700">
            {user.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="Profile"
                className="h-12 w-12 rounded-full"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-lg font-bold text-white">
                {user.email.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">
                {user.user_metadata?.name ?? user.email}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{user.email}</p>
            </div>
          </div>

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
    </div>
  )
}
