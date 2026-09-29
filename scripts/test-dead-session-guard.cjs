// Prove scripts/test-dead-session.cjs fails when the dead-token handling goes away.
//
// Three breaks, one per thing that can regress independently: the recognition, the
// sign-out, and the share path. The last one is the subtlest -- `notifyShare` uses
// `fetch` rather than the REST client, so it never reaches the shared handler on its
// own, and it was the only place still failing after everything else recovered.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const TEST = path.join(__dirname, 'test-dead-session.cjs')

const run = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function patch(relative, from, to) {
  const full = path.join(root, relative)
  const original = fs.readFileSync(full, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')

  if (from === '' || !lf.includes(from)) return null

  const patched = lf.replace(from, to)
  if (patched === lf) return null

  const crlf = original.includes('\r\n')
  fs.writeFileSync(full, crlf ? patched.replace(/\n/g, '\r\n') : patched, 'utf8')

  return () => {
    fs.writeFileSync(full, original, 'utf8')
    if (fs.readFileSync(full, 'utf8') !== original) {
      console.log(`FAIL  could not restore ${relative}`)
      process.exitCode = 1
    }
  }
}

const BREAKS = [
  {
    label: 'the project stops recognising a dead token at all',
    file: 'src/lib/supabase.ts',
    from: "  if (error.code === 'PGRST301') return true",
    to: '  if (false) return true',
    expect: 'a dead token is not recognised',
  },
  {
    label: 'a 42501 RLS refusal is no longer excluded, so viewers get signed out',
    file: 'src/lib/supabase.ts',
    from: "  if (error.code === '42501') return false",
    to: '',
    expect: 'does not exclude 42501',
  },
  {
    // The break that was here removed the log line, and passed. The log line is not
    // the thing under test -- the sign-out is -- so a test can read the file, see
    // `auth.signOut()` still present, and approve a function that recognises a dead
    // token and then keeps using it. A break has to remove the thing being checked.
    label: 'the dead session is recognised but never cleared',
    file: 'src/store/writeErrors.ts',
    from: "    console.warn(\n      '[auth] the project rejected this session outright; clearing it. A signing-key ' +\n        'rotation orphans every token issued before it, and the app cannot tell that ' +\n        'from an expired one.',\n    )\n    await supabase?.auth.signOut()\n    return\n  }",
    to: '    return\n  }',
    expect: 'the session is never cleared',
  },
  {
    label: 'the share path stops handling a 401, which is where it was noticed',
    file: 'src/store/supabase-sync.ts',
    from: '    if (response.status === 401) {',
    to: '    if (response.status === 418) {',
    expect: 'does not look at the 401 status',
  },
  {
    label: 'the user is no longer told signing in again is the fix',
    file: 'src/store/writeErrors.ts',
    from: ".pushToast('Your session has expired. Sign in again to keep working.', 'error')",
    to: ".pushToast('Something went wrong.', 'error')",
    expect: 'does not say the session has expired',
  },
]

let caught = 0
let checked = 0

for (const brk of BREAKS) {
  const restore = patch(brk.file, brk.from, brk.to)
  if (!restore) {
    console.log(`SKIP  ${brk.label}\n      the text to change is not in ${brk.file} -- it has moved`)
    continue
  }
  checked += 1

  try {
    try {
      run()
      console.log(`  ${brk.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes(brk.expect)
      console.log(
        `  ${brk.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`,
      )
      if (right) caught += 1
      else {
        const first = out.split('\n').find((l) => l.trim().startsWith('FAIL'))
        console.log(`      ${(first || '').trim().slice(0, 200)}`)
      }
    }
  } finally {
    restore()
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
console.log('every file restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
