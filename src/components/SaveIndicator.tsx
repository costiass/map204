import { AlertCircle, Check, CloudUpload, Loader2 } from 'lucide-react'

import { useCanvasStore } from '@/store/useCanvasStore'
import { flushPageNow } from '@/hooks/usePageSync'

/**
 * Whether your work is on the server, in the top bar.
 *
 * Somewhere quiet and always present, because the question it answers is asked
 * constantly and never by name: *is this safe yet?* A toast cannot answer that —
 * it appears and goes, and its absence is ambiguous between "nothing happened"
 * and "it finished a while ago".
 *
 * So the states are:
 *
 *   clean    nothing to say. Deliberately nearly invisible: a permanent "Saved"
 *            in the corner is noise that trains people to stop reading it, and
 *            the one time it matters it will be the moment they are not looking.
 *   unsaved  an edit is not on the server yet. This is the state that earns the
 *            space. The debounce is about a second long, so it is visible for a
 *            second on every keystroke-batch — which is exactly the moment
 *            somebody glances up to check.
 *   saving   a write is in flight.
 *   failed   sticky, and red. It stays until a write succeeds, because a failure
 *            that quietly reverts to "saved" is the single most dangerous thing
 *            this component could do.
 */
export function SaveIndicator() {
  const state = useCanvasStore((s) => s.saveState)

  if (state === 'clean') {
    return (
      <span
        className="flex shrink-0 items-center gap-1 text-[11px] text-muted"
        title="Everything on this page is saved."
      >
        <Check size={12} className="opacity-70" aria-hidden="true" />
        Saved
      </span>
    )
  }

  if (state === 'failed') {
    return (
      <button
        type="button"
        onClick={() => void flushPageNow()}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-danger transition hover:bg-surface-sunken"
        title="This page could not be saved. Click to try again."
      >
        <AlertCircle size={12} aria-hidden="true" />
        Not saved
      </button>
    )
  }

  return (
    <span
      className="flex shrink-0 items-center gap-1 text-[11px] text-muted"
      role="status"
      aria-live="polite"
    >
      {state === 'saving' ? (
        <Loader2 size={12} className="animate-spin opacity-70" aria-hidden="true" />
      ) : (
        <CloudUpload size={12} className="opacity-70" aria-hidden="true" />
      )}
      {state === 'saving' ? 'Saving' : 'Unsaved'}
    </span>
  )
}
