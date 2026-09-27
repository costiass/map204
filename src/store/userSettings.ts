import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type { SupabaseUser } from '@/lib/supabase'

export type ThemeMode = 'light' | 'dark'
export type GridPattern = 'none' | 'dots' | 'lines'

export interface UserSettings {
  theme: ThemeMode
  defaultSnapToGrid: boolean
  defaultGridPattern: GridPattern
  defaultGridSize: number
}

interface UserSettingsStore {
  settings: UserSettings
  loading: boolean
  loaded: boolean
  /** The signed-in user, remembered so a change can be written out on its own. */
  userId: string | null
  setTheme: (theme: ThemeMode) => void
  setDefaultSnapToGrid: (enabled: boolean) => void
  setDefaultGridPattern: (pattern: GridPattern) => void
  setDefaultGridSize: (size: number) => void
  /** `GET /user_settings` — creates the row on first run. */
  loadSettings: (user: SupabaseUser) => Promise<void>
  /** `POST /user_settings` (upsert on `user_id`). */
  saveSettings: (user?: SupabaseUser) => Promise<void>
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  defaultSnapToGrid: true,
  defaultGridPattern: 'dots',
  defaultGridSize: 20,
}

/** Slider drags fire a change per pixel; batch them into one upsert. */
const SAVE_DEBOUNCE_MS = 400

export const useUserSettings = create<UserSettingsStore>()((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** Every setter goes through here: change the state, then persist it. */
  const update = (patch: Partial<UserSettings>) => {
    set((state) => ({ settings: { ...state.settings, ...patch } }))
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void get().saveSettings()
    }, SAVE_DEBOUNCE_MS)
  }

  return {
    settings: DEFAULT_SETTINGS,
    loading: false,
    loaded: false,
    userId: null,

    setTheme: (theme) => update({ theme }),
    setDefaultSnapToGrid: (defaultSnapToGrid) => update({ defaultSnapToGrid }),
    setDefaultGridPattern: (defaultGridPattern) => update({ defaultGridPattern }),
    setDefaultGridSize: (defaultGridSize) => update({ defaultGridSize }),

    loadSettings: async (user) => {
      if (!supabase) return
      set({ loading: true, userId: user.id })

      const { data, error } = await supabase
        .from('user_settings')
        .select('theme, default_snap_to_grid, default_grid_pattern, default_grid_size')
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('[settings] load:', error.message)
        set({ loading: false, loaded: false })
        return
      }

      if (data) {
        set({
          settings: {
            theme: (data.theme as ThemeMode) ?? 'light',
            defaultSnapToGrid: data.default_snap_to_grid ?? true,
            defaultGridPattern: (data.default_grid_pattern as GridPattern) ?? 'dots',
            defaultGridSize: data.default_grid_size ?? 20,
          },
          loading: false,
          loaded: true,
        })
        return
      }

      // The signup trigger normally creates this row; if it is missing for any
      // reason (an account that predates the trigger), create it now.
      set({ loading: false, loaded: true })
      await get().saveSettings(user)
    },

    saveSettings: async (user) => {
      const db = supabase
      if (!db) return

      const userId = user?.id ?? get().userId
      if (!userId) return
      const { settings } = get()

      const { error } = await db
        .from('user_settings')
        .upsert(
          {
            user_id: userId,
            theme: settings.theme,
            default_snap_to_grid: settings.defaultSnapToGrid,
            default_grid_pattern: settings.defaultGridPattern,
            default_grid_size: settings.defaultGridSize,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )

      if (error) {
        console.error('[settings] save:', error.message)
      }
    },
  }
})
