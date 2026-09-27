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
  setTheme: (theme: ThemeMode) => void
  setDefaultSnapToGrid: (enabled: boolean) => void
  setDefaultGridPattern: (pattern: GridPattern) => void
  setDefaultGridSize: (size: number) => void
  loadSettings: (user: SupabaseUser) => Promise<void>
  saveSettings: (user: SupabaseUser) => Promise<void>
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  defaultSnapToGrid: true,
  defaultGridPattern: 'dots',
  defaultGridSize: 20,
}

export const useUserSettings = create<UserSettingsStore>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,

  setTheme: (theme) => {
    set((s) => ({ settings: { ...s.settings, theme } }))
  },
  setDefaultSnapToGrid: (defaultSnapToGrid) => {
    set((s) => ({ settings: { ...s.settings, defaultSnapToGrid } }))
  },
  setDefaultGridPattern: (defaultGridPattern) => {
    set((s) => ({ settings: { ...s.settings, defaultGridPattern } }))
  },
  setDefaultGridSize: (defaultGridSize) => {
    set((s) => ({ settings: { ...s.settings, defaultGridSize } }))
  },

  loadSettings: async (user) => {
    if (!supabase) return
    set({ loading: true })
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!error && data) {
      set({
        settings: {
          theme: (data.theme as ThemeMode) ?? 'light',
          defaultSnapToGrid: data.default_snap_to_grid ?? true,
          defaultGridPattern: (data.default_grid_pattern as GridPattern) ?? 'dots',
          defaultGridSize: data.default_grid_size ?? 20,
        },
      })
    }
    set({ loading: false })
  },

  saveSettings: async (user) => {
    if (!supabase) return
    const { settings } = get()
    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        theme: settings.theme,
        default_snap_to_grid: settings.defaultSnapToGrid,
        default_grid_pattern: settings.defaultGridPattern,
        default_grid_size: settings.defaultGridSize,
        updated_at: new Date().toISOString(),
      })
    if (error) {
      console.error('Failed to save settings:', error.message)
    }
  },
}))
