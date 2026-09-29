/**
 * Batched writes, with nothing in them but the batching.
 *
 * ## Why this is a separate module
 *
 * Because it can be tested. The saving itself needs Supabase, a session and a
 * workspace; the part that decides *when* to save and *what* to merge needs none of
 * that, and that part is where the bugs were. Three of them:
 *
 *   * the debounce was 900ms where the default-style save is 400ms, so the camera
 *     took more than twice as long to be remembered as the colours beside it;
 *   * a failed write dropped the settings on the floor -- the queue was cleared
 *     before the write resolved, so an error lost the data with nothing to retry;
 *   * nothing retried at all, so one failed request and the position was gone.
 *
 * Each of those is a way a person sets a camera, looks at it later, and finds it
 * missing, with no error anywhere. All three are fixed by making the queue hold the
 * value until the write has actually succeeded.
 */

export interface SaveQueueOptions<T> {
  /** How long to wait for the value to stop changing before writing. */
  debounceMs: number
  /** Called with the merged value. Returning a rejected promise means "try again". */
  write: (value: T) => Promise<void>
  /** Called when a write has failed `retries` times. */
  onError?: (error: unknown) => void
  /** How many times to retry before giving up. */
  retries?: number
  /** Used between retries. Injected so a test does not have to wait. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface SaveQueue<T> {
  /** Merge a patch into the pending value and schedule a write. */
  push: (patch: T | ((current: T) => T)) => void
  /** Write anything pending, now. */
  flush: () => void
  /** Whether anything is waiting. */
  isPending: () => boolean
  /** Stop the queue and forget it. */
  clear: () => void
}

export function createSaveQueue<T>(options: SaveQueueOptions<T>): SaveQueue<T> {
  const { debounceMs, write, onError, retries = 2 } = options

  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never))

  // The value waiting to be written, and whether a write is in flight for it.
  let pending: T | null = null
  let timer: unknown = null
  let inFlight = false
  let failedAttempts = 0

  const schedule = () => {
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      void drain()
    }, debounceMs)
  }

  async function drain(): Promise<void> {
    // A write already running means this value is already in the queue; letting a
    // second one start would send two upserts and the slower one could land last,
    // overwriting the newer value with the older one.
    if (inFlight) {
      schedule()
      return
    }

    const value = pending
    if (value === null) return

    inFlight = true
    try {
      await write(value)
      // Only clear once the write has actually succeeded. Clearing before was the
      // bug: an error lost the value, and there was nothing left to retry.
      if (pending === value) pending = null
      failedAttempts = 0
    } catch (error) {
      failedAttempts += 1
      onError?.(error)
      if (failedAttempts <= retries) {
        // The value is still in `pending`, so this is a genuine retry of the same
        // data rather than a fresh change that happened to be sitting there.
        schedule()
      }
    } finally {
      inFlight = false
    }
  }

  return {
    push: (patch) => {
      pending =
        typeof patch === 'function'
          ? (patch as (current: T) => T)(pending as T)
          : patch
      schedule()
    },

    flush: () => {
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
      void drain()
    },

    isPending: () => pending !== null || inFlight,

    clear: () => {
      if (timer !== null) clearTimer(timer)
      timer = null
      pending = null
      inFlight = false
      failedAttempts = 0
    },
  }
}
