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
 * The token is one the project will not accept any more.
 *
 * A browser holds its session in localStorage, and the token in it is only good
 * until the project's signing keys rotate. Supabase rotates them, and when it
 * does, a token issued before the rotation names a `kid` that is no longer
 * published, and the signature stops verifying:
 *
 *   PGRST301  None of the keys was able to decode the JWT
 *   bad_jwt   invalid JWT: ... token signature is invalid
 *
 * `autoRefreshToken` does not help. It refreshes shortly before `exp`, and this
 * token's `exp` is still hours away -- it is not old, it is *orphaned*, and
 * nothing in the client notices until a request fails. The symptom is app-wide
 * and reads like a broken backend: every write refused, the share dialog saying
 * "Not signed in." for an account that plainly is signed in.
 *
 * The only cure is a new token, and the only way to get one is to sign in again.
 * So this is detected and acted on rather than left to fail one request at a time.
 */
export function isDeadToken(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST301') return true
  if (error.code === '42501') return false
  const message = error.message ?? ''
  return (
    /invalid jwt|bad_jwt|jwt signature|jwt expired|token signature is invalid/i.test(message) ||
    /none of the keys was able to decode the jwt/i.test(message)
  )
}

/**
 * Confirms the session still names a real account, and still verifies.
 *
 * GoTrue answers 403 for a token whose `sub` no longer exists, which is the only
 * way to notice the first case before the first write fails. It also answers for
 * a token it can no longer verify, which is the second case and the one that has
 * no other symptom until something asks for data.
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
