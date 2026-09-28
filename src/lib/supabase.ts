import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const isConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isConfigured) {
  console.error(
    '[Supabase] Not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.',
  )
}

export { supabaseUrl, supabaseAnonKey }

export const supabase = isConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 20 },
      },
    })
  : null

export function isSupabaseConfigured(): boolean {
  return isConfigured
}

/** The current JWT, used by keepalive flushes that bypass supabase-js. */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/**
 * PostgREST error 23503 — the request referenced an `auth.users` row that is not
 * there.
 *
 * In this app that almost always means one thing: the session's user was
 * deleted (a database rebuilt, an account removed) while the browser still held
 * its JWT. The token keeps verifying, because the project's signing secret did
 * not change, so the app believes it is signed in and every write fails on a
 * foreign key.
 */
export function isMissingAuthUser(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23503'
}

/**
 * Confirms the session still names a real account. GoTrue answers 403 for a
 * token whose `sub` no longer exists, which is the only way to notice this
 * before the first write fails.
 */
export async function sessionUserExists(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.auth.getUser()
  return !error && Boolean(data.user)
}

export type SupabaseUser = {
  id: string
  email: string
  user_metadata?: { name?: string; avatar_url?: string; picture?: string }
}
