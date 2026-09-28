import { isMissingAuthUser, supabase } from '@/lib/supabase'
import { useCanvasStore } from '@/store/useCanvasStore'

/**
 * One place that decides what a failed write means.
 *
 * Most errors are the user's problem to see and ours to log. One is not: a
 * foreign key violation on a user id means the signed-in account no longer
 * exists — the database was rebuilt, or the account was deleted, while the
 * browser kept a JWT that still verifies. Nothing the app does can succeed in
 * that state, and retrying makes it worse, so the only useful response is to say
 * so once and sign out.
 */

let reported = false
/** One toast per distinct explanation, so a retry loop cannot spam the screen. */
const explained = new Set<string>()

export async function handleWriteError(
  error: { code?: string; message?: string } | null,
  context: string,
): Promise<void> {
  if (isMissingAuthUser(error)) {
    if (!reported) {
      reported = true
      useCanvasStore
        .getState()
        .pushToast('Your account is no longer on this database. Sign in again.', 'error')
    }
    // Clears the session, which also stops the debounced settings writer and
    // the autosave timers from retrying into the same wall.
    await supabase?.auth.signOut()
    return
  }

  // 42501 with "row-level security policy" is Postgres naming the rule that
  // refused the write, which tells a developer everything and a person using the
  // app nothing. Every row in this schema is behind RLS, so it is the expected
  // answer for "you do not have permission to do that" — worth saying in words,
  // once, rather than leaving the raw string in the console to be decoded.
  if (error?.code === '42501' && /row-level security/i.test(error.message ?? '')) {
    const key = `rls:${context}`
    if (!explained.has(key)) {
      explained.add(key)
      useCanvasStore
        .getState()
        .pushToast(
          'You do not have permission to change this workspace. Ask the owner for edit access.',
          'error',
        )
    }
  }

  console.error(`[${context}]`, error?.message ?? error)
}

/** Lets a later sign-in report the problem again. */
export function resetAuthErrorReport(): void {
  reported = false
  explained.clear()
}
