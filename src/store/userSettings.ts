import { create } from 'zustand'

import { supabase } from '@/lib/supabase'
import type { SupabaseUser } from '@/lib/supabase'
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  type AccentId,
  type ThemeMode,
  type ThemePalette,
} from '@/theme'

export type { AccentId, ThemeMode, ThemePalette }

/** What the account stores. Appearance and the grid defaults live together. */
export interface UserSettings {
  // Appearance
  theme: ThemeMode
  palette: ThemePalette
  accent: AccentId
  cardRadius: number
  reduceMotion: boolean
  // Canvas defaults
  defaultSnapToGrid: boolean
  defaultGridPattern: 'none' | 'dots' | 'lines'
  defaultGridSize: number
}

interface UserSettingsStore {
  settings: UserSettings
  loading: boolean
  loaded: boolean
  /** The signed-in user, remembered so a change can be written out on its own. */
  userId: string | null
  setTheme: (theme: ThemeMode) => void
  setPalette: (palette: ThemePalette) => void
  setAccent: (accent: AccentId) => void
  setCardRadius: (radius: number) => void
  setReduceMotion: (reduce: boolean) => void
  setDefaultSnapToGrid: (enabled: boolean) => void
  setDefaultGridPattern: (pattern: UserSettings['defaultGridPattern']) => void
  setDefaultGridSize: (size: number) => void
  /** `GET /user_settings` — creates the row on first run. */
  loadSettings: (user: SupabaseUser) => Promise<void>
  /** `POST /user_settings` (upsert on `user_id`). */
  saveSettings: (user?: SupabaseUser) => Promise<void>
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: DEFAULT_APPEARANCE.mode,
  palette: DEFAULT_APPEARANCE.palette,
  accent: DEFAULT_APPEARANCE.accent,
  cardRadius: DEFAULT_APPEARANCE.cardRadius,
  reduceMotion: DEFAULT_APPEARANCE.reduceMotion,
  defaultSnapToGrid: true,
  defaultGridPattern: 'dots',
  defaultGridSize: 20,
}

/** Slider drags fire a change per pixel; batch them into one upsert. */
const SAVE_DEBOUNCE_MS = 400

export const useUserSettings = create<UserSettingsStore>()((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Every setter goes through here: change the state, repaint the document
   * root immediately so the UI responds without waiting for the network, then
   * persist it.
   */
  const update = (patch: Partial<UserSettings>) => {
    set((state) => {
      const settings = { ...state.settings, ...patch }
      applyAppearance({
        mode: settings.theme,
        palette: settings.palette,
        accent: settings.accent,
        cardRadius: settings.cardRadius,
        reduceMotion: settings.reduceMotion,
      })
      return { settings }
    })

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
    setPalette: (palette) => update({ palette }),
    setAccent: (accent) => update({ accent }),
    setCardRadius: (cardRadius) => update({ cardRadius }),
    setReduceMotion: (reduceMotion) => update({ reduceMotion }),
    setDefaultSnapToGrid: (defaultSnapToGrid) => update({ defaultSnapToGrid }),
    setDefaultGridPattern: (defaultGridPattern) => update({ defaultGridPattern }),
    setDefaultGridSize: (defaultGridSize) => update({ defaultGridSize }),

    loadSettings: async (user) => {
      if (!supabase) return
      set({ loading: true, userId: user.id })

      const { data, error } = await supabase
        .from('user_settings')
        .select(
          'theme, palette, accent, card_radius, reduce_motion, default_snap_to_grid, default_grid_pattern, default_grid_size',
        )
        .eq('user_id', user.id)
        .maybeSingle()

      if (error) {
        console.error('[settings] load:', error.message)
        set({ loading: false, loaded: false })
        return
      }

      const next: UserSettings = data
        ? {
            theme: (data.theme as ThemeMode) ?? 'light',
            palette: (data.palette as ThemePalette) ?? DEFAULT_APPEARANCE.palette,
            accent: (data.accent as AccentId) ?? DEFAULT_APPEARANCE.accent,
            cardRadius: data.card_radius ?? DEFAULT_APPEARANCE.cardRadius,
            reduceMotion: data.reduce_motion ?? false,
            defaultSnapToGrid: data.default_snap_to_grid ?? true,
            defaultGridPattern:
              (data.default_grid_pattern as UserSettings['defaultGridPattern']) ?? 'dots',
            defaultGridSize: data.default_grid_size ?? 20,
          }
        : DEFAULT_SETTINGS

      // Repaint before flipping `loaded`, so the panel never renders light.
      applyAppearance({
        mode: next.theme,
        palette: next.palette,
        accent: next.accent,
        cardRadius: next.cardRadius,
        reduceMotion: next.reduceMotion,
      })
      set({ settings: next, loading: false, loaded: true })

      if (!data) {
        // The signup trigger normally creates this row; if it is missing for any
        // reason (an account that predates the trigger), create it now.
        await get().saveSettings(user)
      }
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
            palette: settings.palette,
            accent: settings.accent,
            card_radius: settings.cardRadius,
            reduce_motion: settings.reduceMotion,
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
