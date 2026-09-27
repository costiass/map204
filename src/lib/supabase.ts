import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isConfigured) {
  console.error(
    '[Supabase] Not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.',
  )
}

export const supabase = isConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
  : null

export function isSupabaseConfigured(): boolean {
  return isConfigured
}

export type SupabaseUser = {
  id: string
  email: string
  user_metadata?: { name?: string; avatar_url?: string; picture?: string }
}
