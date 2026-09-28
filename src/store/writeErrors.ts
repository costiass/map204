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

  console.error(`[${context}]`, error?.message ?? error)
}

/** Lets a later sign-in report the problem again. */
export function resetAuthErrorReport(): void {
  reported = false
}
