// Prove scripts/test-share-email-catch.cjs fails when the catch-all is removed.
//
// One break, because the property is single: a throw must not escape the handler.
// The failure it guards against is specific and ugly -- the edge gateway answers an
// uncaught throw with a 60-byte `EDGE_FUNCTION_ERROR` body and none of the
// function's own CORS headers, which is what turned a share failure into an
// unreadable one in the first place.
//
// ## If this reports 0 of 0, the pattern below has gone stale
//
// The `from` is a copy of the catch block in `index.ts`, and it has to be: the
// break is a text substitution, so it needs text that is there. But a guard that
// holds a duplicate of the code it breaks stops guarding the moment that code is
// edited, and it stops *quietly* -- `patch` reports SKIP, SKIP reads as harmless,
// and "0 of 0 deliberate breaks were caught" is a green line in a suite that is no
// longer proving anything.
//
// It happened here: an edit to the comment above the catch invalidated the copy,
// and the guard reported success while testing nothing. So the copy is refreshed
// from `index.ts` by the two markers below rather than by hand, and if the block
// cannot be found the guard says so instead of passing.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const INDEX = path.join(__dirname, '..', 'supabase', 'functions', 'send-share-email', 'index.ts')
const TEST = path.join(__dirname, 'test-share-email-catch.cjs')

/*
 * The pattern must be present, and the substitution must change the file. Both are
 * checked before anything is run, because "the guard could not set up its break"
 * and "the guard proved the test works" must never look alike.
 */
const CATCH_START = '  } catch (error) {'
const CATCH_END = "    return respond(request, { error: 'The email could not be sent.' }, 500)\n  }"

const currentSource = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n')
const catchStart = currentSource.indexOf(CATCH_START)
const catchEnd = currentSource.indexOf(CATCH_END, catchStart)
if (catchStart < 0 || catchEnd < 0) {
  console.log('FAIL  index.ts no longer has the catch block this guard removes. Either the')
  console.log('      catch-all has gone for good -- in which case test-share-email-catch.cjs is')
  console.log('      testing nothing -- or it moved, and the markers in this file need updating.')
  process.exit(1)
}

const run = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const BREAKS = [
  {
    label: 'the catch-all is gone and the handler throws again',
    from: `  } catch (error) {
    // The stack rather than the message, and logged before the response, because
    // the response is deliberately vague: this is a share notification, not a
    // debugging channel, and it should not become a way to read the server's
    // internals by asking it to fail.
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error('[send-share-email] unhandled:', message)
    return respond(request, { error: 'The email could not be sent.' }, 500)
  }`,
    to: '  } finally { /* nothing catches */ }',
    // Without the catch, the runtime answers the throw itself, and two checks
    // notice: the status is not the function's own 500, and the response carries
    // none of the headers this function sets on everything it sends. The second
    // names the actual problem -- the gateway answered, not the function -- so
    // that is the one matched on.
    expect: 'answered by the edge gateway',
  },
]

let caught = 0
let checked = 0

for (const brk of BREAKS) {
  const original = fs.readFileSync(INDEX, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')
  if (!lf.includes(brk.from)) {
    console.log(`SKIP  ${brk.label}\n      the text to change is not in index.ts -- it has moved`)
    continue
  }
  const crlf = original.includes('\r\n')
  fs.writeFileSync(
    INDEX,
    (crlf ? lf.replace(brk.from, brk.to).replace(/\n/g, '\r\n') : lf.replace(brk.from, brk.to)),
    'utf8',
  )
  checked += 1

  try {
    try {
      run()
      console.log(`  ${brk.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes(brk.expect)
      console.log(`  ${brk.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (right) caught += 1
      else {
        const first = out.split('\n').find((l) => l.trim().startsWith('FAIL'))
        console.log(`      ${(first || '').trim().slice(0, 220)}`)
      }
    }
  } finally {
    fs.writeFileSync(INDEX, original, 'utf8')
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
console.log('every file restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
