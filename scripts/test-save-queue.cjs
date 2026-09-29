// Run the save queue.
//
// This one executes the code rather than reading it, which is the whole point: the
// earlier attempts at guarding the camera were source scans, and four of their six
// deliberate breaks passed -- they answered "yes" to broken code. A test that reads
// a file can only check that a shape is present. This one drives the queue with a
// fake writer and a fake clock, so every claim below is something that happened.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src', 'store', 'saveQueue.ts')

/*
 * Compile the real file, and run that.
 *
 * The first version stripped the types with a chain of regexes and then failed on
 * `<T>` in a function signature -- four attempts in a row, each a slightly
 * different way of the same mistake. Regex is not a TypeScript parser.
 *
 * `transpileModule` is the compiler's own type-stripper. It does no type checking
 * and no module resolution, so it needs nothing to exist beyond the file itself.
 *
 * What runs is the file as written, not a copy of it. A hand-maintained copy is a
 * second version, and it is the copy that gets tested the moment the two disagree --
 * which is the failure this whole exercise has been about.
 */
const js = ts.transpileModule(fs.readFileSync(SRC, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const module_ = { exports: {} }
new Function('module', 'exports', 'require', js)(module_, module_.exports, require)
const { createSaveQueue } = module_.exports

let failures = 0
let checks = 0
const fail = (m) => {
  console.log(`FAIL  ${m}`)
  failures += 1
}
const ok = (m) => console.log(`  ${m}`)

;(async () => {
  /** A clock the test drives, so nothing has to actually wait. */
  function fakeClock() {
    let now = 0
    let seq = 0
    const timers = new Map()
    return {
      setTimer: (fn, ms) => {
        seq += 1
        timers.set(seq, { at: now + ms, fn })
        return seq
      },
      clearTimer: (handle) => timers.delete(handle),
      /*
       * Drain to a fixed point, not once.
       *
       * The queue's `drain` is async, so a timer fired here is still inside its
       * `await` when this returns -- and the next `advance` then runs a second timer
       * while the first write is still in flight, which the queue correctly refuses
       * to do. The visible effect was a retry that looked like it never happened,
       * and a passing test that was really reporting its own timing.
       *
       * So: fire everything due, yield, and keep going while more timers appear.
       * That is what a real event loop does, and the only way a fake clock can be
       * honest about async work.
       */
      advance: async (ms) => {
        now += ms
        for (let round = 0; round < 20; round += 1) {
          const due = [...timers.entries()].filter(([, t]) => t.at <= now)
          if (due.length === 0) break
          for (const [id, t] of due) {
            timers.delete(id)
            t.fn()
          }
          for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r))
        }
      },
    }
  }

  /* 1. A change is written once the value stops changing ----------------------- */

  {
    checks += 1
    const clock = fakeClock()
    const written = []
    const q = createSaveQueue({
      debounceMs: 400,
      write: async (v) => {
        written.push(v)
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    q.push('a')
    await clock.advance(399)
    q.push('b')
    await clock.advance(399)
    if (written.length !== 0) {
      fail(`wrote ${written.length} time(s) before the value stopped changing; the debounce is not holding.`)
    } else ok('a change in flight is not written until the value settles')

    await clock.advance(2)
    if (written.length !== 1) {
      fail(`expected exactly one write after settling, got ${written.length}.`)
    } else ok('one write, carrying the last value, not every value on the way')
    if (written[0] !== 'b') {
      fail(`the write carried ${JSON.stringify(written[0])}; the last value is the one that should be kept.`)
    }
  }

  /* 2. The value is only dropped once the write has succeeded ------------------ */

  {
    checks += 1
    const clock = fakeClock()
    let attempt = 0
    const queue = createSaveQueue({
      debounceMs: 400,
      retries: 2,
      write: async () => {
        attempt += 1
        if (attempt === 1) throw new Error('network')
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    queue.push('camera')
    await clock.advance(400)
    if (attempt !== 1) fail('the failing write was never attempted')
    if (!queue.isPending()) {
      fail(
        'a failed write dropped the value. It is the difference between "the camera was ' +
          'not remembered once" and "the camera is never remembered again" -- the first ' +
          'is a lost request, the second loses every camera from then on.',
      )
    } else ok('a failed write keeps the value instead of dropping it')

    await clock.advance(400)
    if (attempt !== 2) fail(`expected a retry after a failure, got ${attempt} attempt(s)`)
    else ok('the same value is retried rather than waiting for a new change')

    await clock.advance(400)
    if (queue.isPending()) {
      fail('the value was never cleared after the write succeeded.')
    } else ok('the value is cleared once a write has actually succeeded')
  }

  /* 3. A failure is not retried forever ---------------------------------------- */

  {
    checks += 1
    const clock = fakeClock()
    let attempts = 0
    const errors = []
    const queue = createSaveQueue({
      debounceMs: 400,
      retries: 2,
      write: async () => {
        attempts += 1
        throw new Error('always')
      },
      onError: (e) => errors.push(e),
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    queue.push('x')

    // Stepped, not one long jump. A single `advance` fires every timer that becomes
    // due inside it -- including the retry the first failure scheduled -- so the
    // count is already final by the time it is read. The earlier version of this
    // check reported "1 attempt" as though bounded retries were what it was
    // testing, and passed on a queue that had given up immediately.
    for (let i = 0; i < 10; i += 1) await clock.advance(500)

    // Both directions. An upper bound alone is satisfied by a queue that retries
    // zero times, which loses the camera on the first dropped request.
    if (attempts < 3) {
      fail(
        `${attempts} attempt(s) for a value that never saved, expected 1 plus 2 ` +
          'retries. Giving up at once loses the camera on the first dropped ' +
          'request, which is the case that matters.',
      )
    } else if (attempts > 3) {
      fail(
        `${attempts} attempts for one value that never saved, expected 3. A ` +
          'camera that cannot be written would otherwise retry on every pan, ' +
          'for ever.',
      )
    } else ok('retries a bounded number of times, then gives up')

    if (errors.length === 0) fail('a failing write reported nothing; a silent failure is the worst kind')
    else ok('every failure is reported')
  }

  /* 4. Two changes do not race, and the newer one wins ------------------------- */

  {
    checks += 1
    const clock = fakeClock()
    const order = []
    let release
    const gate = new Promise((r) => {
      release = r
    })

    const queue = createSaveQueue({
      debounceMs: 400,
      write: async (v) => {
        order.push(`start:${v}`)
        if (v === 'old') await gate
        order.push(`done:${v}`)
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    queue.push('old')
    await clock.advance(400) // the slow write starts and is still running

    queue.push('new')
    await clock.advance(400) // would start a second write if there were no guard

    release()
    await new Promise((r) => setImmediate(r))
    await clock.advance(400)

    const starts = order.filter((o) => o.startsWith('start:'))
    if (starts.length > 2) {
      fail(`${starts.length} writes were in flight at once; they can land out of order.`)
    } else ok('a second write waits for the one in flight rather than racing it')

    const lastDone = order.filter((o) => o.startsWith('done:')).pop()
    if (lastDone !== 'done:new') {
      fail(`the last write to finish was ${lastDone}; the newer value must be the one that lands.`)
    } else ok('the newer value is the one that lands last')
  }

  /* 5. flush writes now, without waiting -------------------------------------- */

  {
    checks += 1
    const clock = fakeClock()
    const written = []
    const queue = createSaveQueue({
      debounceMs: 400,
      write: async (v) => {
        written.push(v)
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })

    queue.push('last-move')
    // No time passes at all: this is "pan somewhere, close the tab".
    queue.flush()
    await new Promise((r) => setImmediate(r))

    if (written.length !== 1 || written[0] !== 'last-move') {
      fail(
        `flush wrote ${written.length} time(s), ${JSON.stringify(written)}. Without this, a ` +
          "camera set in the last moment before closing the tab is never written -- which " +
          'is the most common way a camera is set.',
      )
    } else ok('flush writes the pending value immediately')
  }

  if (failures === 0) {
    console.log(`\nsave queue: ${checks} checks, all run rather than read -- a settled write, no ` +
      'value lost to a failure, a bounded retry, no racing writes, and a flush that does not ' +
      'wait.')
  } else {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
})().catch((error) => {
  console.log(`FAIL  the test itself broke: ${error.message}`)
  process.exit(1)
})
