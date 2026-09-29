// Prove the handler's catch-all works, and that it is load-bearing.
//
// The failure it exists for: an uncaught throw in an edge function is answered by
// the *gateway*, not the function. The gateway's 502 is a fixed 60-byte body with
// `sb-error-code: EDGE_FUNCTION_ERROR` and no CORS headers of the function's own,
// naming neither the message nor the stack. That is exactly the failure this
// project already fixed one layer down -- an error the browser cannot read --
// except here the browser *can* read it and still learns nothing.
//
// So this test does the only thing that proves it: it makes the handler throw, and
// checks the answer is a real response from the function carrying CORS and a
// message, rather than the gateway's opaque 502.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const CONTAINER = 'map204-edge-catch'
const IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.76.2'
const PORT = 8098
const DIR = path.join(__dirname, '..', 'supabase', 'functions', 'send-share-email')
const INDEX = path.join(DIR, 'index.ts')

let failures = 0
let checked = 0
const fail = (m) => {
  console.log(`FAIL  ${m}`)
  failures += 1
}
const skip = (m) => {
  console.log(`SKIP  ${m}`)
  process.exit(0)
}

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' })
  execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' })
} catch {
  skip('Docker or the edge runtime image is absent, so the catch-all cannot be exercised.')
}

const original = fs.readFileSync(INDEX, 'utf8')
const lf = original.replace(/\r\n/g, '\n')

/* -- build a copy of the function whose handler throws ---------------------- */
//
// The throw goes at the very top of handle(), before the preflight. That is not
// where the real one happened -- it was on the authenticated path, after the auth
// checks -- but this test cannot reach that path without a real signed-in user, and
// the property under test does not depend on where the throw is: it is that
// *nothing* escapes, not that one particular place is guarded.
//
// Placing it before the auth check is also the harder case, and that is why it is
// the one chosen. A guard that only wraps the inner half of the handler would pass
// a test that threw at the top, and the top is exactly where a future edit is
// most likely to throw.
/*
 * The anchor is matched out of the file, not written down here.
 *
 * It used to be a literal, and it stopped matching when `handle` grew a second
 * argument for the SDK's context -- so this test reported "the anchor is gone" and
 * exited without having proved anything. A pattern that has drifted is the same
 * failure as a test that cannot fail: it looks like a test, and it verifies nothing.
 *
 * Matched by shape -- a function named `handle`, whatever its parameters -- so it
 * survives an edit to the signature and cannot quietly stop guarding.
 */
const ANCHOR = /async function handle\([^)]*\)[^{]*\{/.exec(lf)?.[0]
if (!ANCHOR) {
  console.log('FAIL  index.ts has no `async function handle(...)` to inject a throw into.')
  console.log('      Either the handler was renamed, or this test is no longer testing it.')
  process.exit(1)
}

/*
 * Copied to a scratch directory rather than patched in place and mounted.
 *
 * A bind mount of the real directory does not reliably see a write made after the
 * container has started, on Windows across a Docker Desktop VM. The first version
 * of this test patched `index.ts` in place, mounted the directory read-only, and
 * got a clean 401 back -- which is the *unpatched* function refusing an
 * unauthenticated request before it ever reached the injected line. It read
 * exactly like the catch-all not working, and it was the mount lying.
 *
 * Staging a copy removes the question entirely: there is nothing that can be
 * stale, and the real file is never touched, so a failure here cannot leave the
 * repository holding a deliberate throw.
 */
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'm204-catch-'))
for (const entry of fs.readdirSync(DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  fs.copyFileSync(path.join(DIR, entry.name), path.join(STAGE, entry.name))
}
fs.writeFileSync(
  path.join(STAGE, 'index.ts'),
  lf.replace(ANCHOR, ANCHOR + "\n  throw new Error('probe: deliberate throw on the authenticated path')"),
  'utf8',
)

/*
 * Remove any container with this name, *including one that has already exited*.
 *
 * A `docker run` whose name is taken fails, and the `cleanup()` meant to prevent
 * that used to swallow the error -- so a run that ended badly left an exited
 * container behind holding the name, and every run after it reported:
 *
 *   FAIL  the edge runtime never started listening
 *
 * ...while what had actually happened was that `docker run` had never produced a
 * container at all, and the readiness probe was waiting on a dead one. The message
 * blamed the runtime; the cause was this test's own cleanup. So the removal is
 * verified, and a failure to remove is reported instead of swallowed.
 */
const removeContainer = () => {
  const named = () =>
    spawnSync('docker', ['ps', '-a', '--filter', `name=${CONTAINER}`, '--format', '{{.Names}}'], {
      encoding: 'utf8',
    })

  if (!String(named().stdout || '').trim()) return true

  const removed = spawnSync('docker', ['rm', '-f', CONTAINER], { encoding: 'utf8' })
  if (!String(named().stdout || '').trim()) return true

  console.log(
    `FAIL  could not remove the container ${CONTAINER}, so this run cannot take the ` +
      `name and would end up testing whatever is already there.\n` +
      `      docker said: ${String(removed.stderr || '').trim() || '(nothing)'}`,
  )
  return false
}

const cleanup = () => {
  if (!process.env.M204_KEEP_CONTAINER) removeContainer()
  if (!process.env.M204_KEEP_STAGE) fs.rmSync(STAGE, { recursive: true, force: true })
}
process.on('exit', cleanup)
if (!removeContainer()) process.exit(1)

execFileSync(
  'docker',
  [
    'run', '-d', '--name', CONTAINER,
    '-p', `${PORT}:9000`,
    '-v', `${STAGE}:/home/deno/main:ro`,
    '-e', 'SUPABASE_URL=http://localhost:54321',
    '-e', 'SUPABASE_ANON_KEY=local-anon',
    '-e', 'SUPABASE_SERVICE_ROLE_KEY=local-service',
    '-e', 'RESEND_API_KEY=re_probe',
    '-e', 'APP_URL=https://map204.vercel.app',
    IMAGE, 'start', '--main-service', '/home/deno/main',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  let ready = false
  for (let i = 0; i < 60 && !ready; i += 1) {
    const p = spawnSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', `http://localhost:${PORT}/`], {
      encoding: 'utf8',
    })
    ready = p.status === 0 && /^\d{3}$/.test((p.stdout || '').trim())
    if (!ready) await sleep(1000)
  }
  if (!ready) {
    // Before giving up, say what the container thought. "Never started listening"
    // on its own is the least informative possible message: it is true whether the
    // bundle failed to compile, the port was taken by a container from an earlier
    // run, or the image refused to start, and those need three different fixes.
    const state = spawnSync('docker', ['ps', '-a', '--filter', `name=${CONTAINER}`, '--format', '{{.Status}}'], {
      encoding: 'utf8',
    })
    const status = String(state.stdout || '').trim() || 'no such container'
    const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' })
    const logText = (String(logs.stdout || '') + String(logs.stderr || '')).trim()

    console.log(`FAIL  the edge runtime never started listening (container: ${status})`)
    if (logText) console.log(`      container log: ${logText.slice(-400)}`)
    else console.log('      the container logged nothing, so it never got as far as running.')
    cleanup()
    process.exit(1)
  }

  // A request that hits the deliberate throw on its first line.
  const out = execFileSync(
    'curl.exe',
    [
      '-s', '-i', '-X', 'POST',
      '-H', 'Origin: https://map204.vercel.app',
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ documentId: 'd', to: 'a@b.com' }),
      `http://localhost:${PORT}/`,
    ],
    { encoding: 'utf8' },
  )

  // A container left over from an earlier run on this port would answer, and it
  // would be answering with the *unpatched* function -- which returns 401 before
  // ever reaching the injected throw. That is a test that passes for the wrong
  // reason at best and fails for a completely misleading one at worst, so the
  // container's own log is the authority on what it loaded, not the response.
  const logs = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' })
  const logText = String(logs.stdout || '') + String(logs.stderr || '')
  if (!logText.includes('probe: deliberate throw')) {
    cleanup()
    console.log('FAIL  the container never logged the injected throw, so it did not load the')
    console.log('      patched file. Whatever answered the port was not this test.')
    console.log(`      container log was: ${JSON.stringify(logText.slice(-300))}`)
    process.exit(1)
  }

  const split = out.indexOf('\r\n\r\n')
  const head = out.slice(0, split < 0 ? out.length : split)
  const body = split < 0 ? '' : out.slice(split + 4)
  const status = Number((head.split(/\r?\n/)[0] || '').split(' ')[1])

  const header = (name) => {
    const line = head.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ':'))
    return line ? line.slice(line.indexOf(':') + 1).trim() : undefined
  }

  /* 1. it is a response from the function, not the gateway ---------------- */
  checked += 1
  // The gateway answers a crash with 500 or 502 and never with these headers.
  // `access-control-max-age` is the give-away: it is this function's, set on
  // every response, and the gateway does not invent it.
  if (status !== 500) {
    fail(`a deliberate throw answered ${status}, expected 500 from the function's own catch-all. A gateway 500/502 here means nothing is catching.`)
  }
  if (!/access-control-max-age/i.test(head)) {
    fail(
      'the throw was answered by the edge gateway, not by the function. A gateway ' +
        'answer has no CORS headers of its own, which is what made this ' +
        'unreadable in the first place.',
    )
  }

  /* 2. the browser can read it ------------------------------------------- */
  checked += 1
  if (header('access-control-allow-origin') !== 'https://map204.vercel.app') {
    fail('the catch-all response carries no allow-origin, so the browser cannot read the failure.')
  }

  /* 3. it says something ---------------------------------------------------- */
  checked += 1
  let parsed = null
  try {
    parsed = JSON.parse(body)
  } catch {
    /* handled below */
  }
  if (!parsed || typeof parsed.error !== 'string' || parsed.error.length === 0) {
    fail(`the catch-all response has no usable error text. Body was: ${JSON.stringify(body.slice(0, 120))}`)
  }

  /* 4. and it does not leak the server's internals ------------------------ */
  checked += 1
  if (body.includes('probe: deliberate throw')) {
    fail(
      'the catch-all echoed the exception message to the caller. This is a share ' +
        'notification, not a debugging channel -- it must not become a way to read ' +
        'the server internals by asking it to fail.',
    )
  }

  cleanup()

  if (failures === 0) {
    console.log(
      `share email catch-all: ${checked} checks -- a throw on the authenticated path ` +
        'becomes a readable response with CORS and a reason, not a bare gateway 502.',
    )
  } else {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
})().catch((error) => {
  cleanup()
  console.log(`FAIL  the test itself broke: ${error.message}`)
  process.exit(1)
})
