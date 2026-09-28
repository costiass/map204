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

  // 42501 is Postgres naming the rule that refused the write. It tells a
  // developer exactly what happened and a person using the app nothing, so it is
  // worth translating — but only into what the error *establishes*.
  //
  // It does not establish why. RLS refuses for at least three unrelated reasons
  // here: the account genuinely lacks access, the page belongs to a workspace
  // it does not own, or — as happened — the account is a legitimate editor and
  // the policy is still refusing, which means the cause is a bug. Naming any one
  // of those as *the* cause sends the reader hunting for a problem they do not
  // have, so the message states the refusal and points at the console, which has
  // the code and the statement.
  if (error?.code === '42501' && /row-level security/i.test(error.message ?? '')) {
    const key = `rls:${context}`
    if (!explained.has(key)) {
      explained.add(key)
      /*
       * Silent for a viewer.
       *
       * A viewer's writes are refused by design, so an RLS refusal is not news --
       * it is the arrangement working. Telling them about it is how a read-only
       * guest ends up with a stack of error toasts for things they never did, and
       * the natural conclusion is that the app is broken rather than that it is
       * correctly refusing them.
       *
       * An *editor* hitting the same refusal is a genuine bug and is still told.
       * The distinction is read from the store rather than from the error, because
       * the error cannot tell the two apart -- which is the whole reason the
       * message above refuses to name a cause.
       */
      if (!isViewer()) {
        useCanvasStore
          .getState()
          .pushToast(
            'The server refused that change. If you have edit access, this is a bug — the details are in the console.',
            'error',
          )
      }
    }
  }

  console.error(`[${context}]`, error?.code ?? '', error?.message ?? error)
}

/**
 * Whether the open document is being read rather than edited.
 *
 * `'viewing'` specifically, not "anything read-only". A presenter is also locked, and
 * a presenter *is* supposed to hear about a failed write — presenting is a mode that
 * ends, and anything it could not save would otherwise vanish quietly.
 */
function isViewer(): boolean {
  return useCanvasStore.getState().readOnlyReason === 'viewing'
}

/** Lets a later sign-in report the problem again. */
export function resetAuthErrorReport(): void {
  reported = false
  explained.clear()
}
