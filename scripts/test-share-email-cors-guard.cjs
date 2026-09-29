// Prove scripts/test-share-email-cors.cjs fails when the CORS handling regresses.
//
// The first two breaks are the bug that was actually reported -- the preflight
// answered 405, and no response carrying an Access-Control-Allow-Origin. The rest
// are the realistic ways it comes back: a new early return that forgets the helper,
// an origin echoed instead of checked, a file that no longer parses, and the
// gateway setting lost or restored to the default.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'send-share-email')
const TEST = path.join(__dirname, 'test-share-email-cors.cjs')

const run = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Patch a file, ignoring line endings, and hand back a restore.
 *
 * Three ways this used to be able to destroy the file it was testing, all of them
 * reached in one run:
 *
 *   * An empty `from` matches everywhere, so `String.replace` deletes the entire
 *     file. `index.ts` was 304 lines and became 0.
 *   * `restore` was only called from a `finally` around the *run*, so a throw
 *     between the write and the try -- or an early `continue` -- left the
 *     repository holding a deliberate break.
 *   * A `from` that no longer matched the file was reported as SKIP, which reads
 *     as harmless. It is not: it means the test is guarding a string that has
 *     moved, and it is indistinguishable from a test that is guarding nothing.
 *
 * So: refuse an empty pattern, verify the replacement actually changed something,
 * and verify the restore afterwards. The whole point of this file is to break code
 * on purpose, so it has to be impossible for it to break it by accident.
 */
function patch(file, from, to) {
  // `../config.toml` is the root supabase config, one level up from the function
  // directory. Every other break is in the function's own files.
  const full = path.resolve(dir, file)
  const original = fs.readFileSync(full, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')

  // A reason, not a bare null. The caller has to be able to say how many breaks
  // went un-attempted, because a skip and a pass look the same in a wall of green
  // and only one of them means the guard is still working.
  if (from === '') {
    return { skip: `a break against ${file} has an empty pattern, which would delete it` }
  }
  if (!lf.includes(from)) {
    return { skip: `the text to change is not in ${file} -- it has moved` }
  }

  const patched = lf.replace(from, to)
  if (patched === lf) {
    return { skip: `the pattern in ${file} matched but changed nothing` }
  }

  const crlf = original.includes('\r\n')
  fs.writeFileSync(full, crlf ? patched.replace(/\n/g, '\r\n') : patched, 'utf8')

  const restore = () => {
    fs.writeFileSync(full, original, 'utf8')
    // Verify, because a restore that silently failed is how a deliberate break
    // becomes a permanent one.
    const now = fs.readFileSync(full, 'utf8')
    if (now !== original) {
      console.log(`FAIL  could not restore ${file}. It is left in a broken state.`)
      process.exitCode = 1
    }
  }

  return { restore }
}

const BREAKS = [
  {
    label: 'an unbalanced brace from wrapping the handler -- the deploy looked fine',
    file: 'index.ts',
    from: "  return respond(request, { ok: true, id: result?.id ?? null }, 200)\n}",
    to: "  return respond(request, { ok: true, id: result?.id ?? null }, 200)\n})",
    expect: 'does not parse',
  },
  {
    label: 'the gateway setting goes back to verifying the JWT',
    file: '../../config.toml',
    from: '[functions.send-share-email]\nverify_jwt = false',
    to: '[functions.send-share-email]\nverify_jwt = true',
    expect: 'does not set verify_jwt = false',
  },
  {
    label: 'the [functions] section is dropped from the root config',
    file: '../../config.toml',
    from: '[functions.send-share-email]\nverify_jwt = false',
    to: '# removed',
    expect: 'no [functions.send-share-email] section',
  },
  {
    label: "a refusal from Resend goes back to a shrug -- the reason is never read",
    file: 'index.ts',
    from: '      const resendMessage = (result as { message?: string } | null)?.message ?? \'\'',
    to: "      const resendMessage = ''",
    expect: "Resend's message is never read out of its response",
  },
  {
    label: 'the sender can no longer be configured',
    file: 'index.ts',
    from: "const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'",
    to: "const FROM = 'Map204 <hello@map204.app>'",
    expect: 'the sender address is no longer read from MAIL_FROM',
  },
  {
    label: "Resend's refusal stops at the log and never reaches the dialog",
    file: 'index.ts',
    from: 'console.error(\'[send-share-email] resend refused:\', response.status, result)',
    to: "console.error('[send-share-email] resend refused')",
    expect: 'the refusal is not logged with the status Resend returned',
  },
  {
    // The SDK is the whole of the caller verification. Take it away and the
    // function has no way of knowing who is asking.
    label: 'the SDK that verifies the caller is removed',
    file: 'index.ts',
    from: 'createSupabaseContext(request,',
    to: 'noContext(request,',
    expect: 'does not call createSupabaseContext',
  },
  {
    // 'user' looks more correct than 'none' and is fatal here: the SDK would refuse
    // the preflight, which carries no Authorization header, before the function runs.
    label: "the SDK goes back to auth: 'user', which refuses the preflight",
    file: 'index.ts',
    from: "auth: 'none',",
    to: "auth: 'user',",
    expect: "auth: 'none'",
  },
  {
    // The wrapper, not the context. It answers CORS itself with
    // Access-Control-Allow-Origin: *, which on a function that sends mail is an open
    // relay -- and it overrides the allow-list without the handler ever seeing the
    // request. This one was tried first, and the tests caught it.
    label: 'the handler is wrapped in withSupabase, which answers CORS with a wildcard',
    file: 'index.ts',
    from: "import { createSupabaseContext } from 'npm:@supabase/server'",
    to: "import { withSupabase } from 'npm:@supabase/server'\nvoid withSupabase(",
    expect: 'withSupabase wraps the handler',
  },
  {
    // With auth: 'none' the SDK does not *require* a token, so the handler is the
    // only thing refusing an anonymous caller. This endpoint sends mail on request.
    label: "the handler stops requiring an authenticated caller -- auth: 'none' permits any",
    file: 'index.ts',
    from: '  if (!ctx.authenticated) {',
    to: '  if (false) {',
    expect: 'does not check ctx.authenticated',
  },
  {
    // The id has to come from the verified claims. Anything else makes the
    // ownership check below meaningless.
    label: 'the caller id stops coming from the verified claims',
    file: 'index.ts',
    from: "id: typeof claims.sub === 'string' ? claims.sub : '',",
    to: "id: typeof claims.email === 'string' ? claims.email : '',",
    expect: 'not read from ctx.claims',
  },
  {
    // Reading a key by hand is what caused three of the faults in the first place.
    label: 'a key is read out of the environment again',
    file: 'index.ts',
    from: "const resendKey = Deno.env.get('RESEND_API_KEY')",
    to: "const resendKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''",
    expect: 'SUPABASE_ANON_KEY',
  },
  {
    label: 'the preflight is answered 405 — the bug that was reported',
    file: 'index.ts',
    from: "  if (request.method === 'OPTIONS') {\n    return respond(request, null, 204)\n  }\n\n",
    to: '',
    expect: 'does not answer an OPTIONS preflight',
  },
  {
    label: 'the preflight moves behind the auth check — it has no header to check',
    file: 'index.ts',
    from: "  if (request.method === 'OPTIONS') {\n    return respond(request, null, 204)\n  }\n\n  if (request.method !== 'POST') {\n    return respond(request, { error: 'Method not allowed.' }, 405)\n  }\n\n  const authHeader = request.headers.get('Authorization') ?? ''\n  if (!authHeader.startsWith('Bearer ')) {\n    return respond(request, { error: 'Not signed in.' }, 401)\n  }",
    to: "  if (request.method !== 'POST') {\n    return respond(request, { error: 'Method not allowed.' }, 405)\n  }\n\n  const authHeader = request.headers.get('Authorization') ?? ''\n  if (!authHeader.startsWith('Bearer ')) {\n    return respond(request, { error: 'Not signed in.' }, 401)\n  }\n\n  if (request.method === 'OPTIONS') {\n    return respond(request, null, 204)\n  }",
    expect: 'the auth check runs before the OPTIONS preflight',
  },
  {
    label: 'a new error path returns Response.json and forgets the headers',
    file: 'index.ts',
    from: "    return respond(request, { error: 'documentId and to are required.' }, 400)",
    to: "    return Response.json({ error: 'documentId and to are required.' }, { status: 400 })",
    expect: 'Response.json, which sets no CORS headers',
  },
  {
    label: 'the origin is echoed instead of checked — an open relay',
    file: 'index.ts',
    from: "  if (!ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' }",
    to: "  void ALLOWED_ORIGINS",
    expect: 'the Origin is not checked against a list',
  },
  {
    label: 'the allow-list is thrown away and everything allowed',
    file: 'index.ts',
    from: "    'Access-Control-Allow-Origin': origin,",
    to: "    'Access-Control-Allow-Origin': '*',",
    expect: 'Access-Control-Allow-Origin is `*`',
  },
  {
    label: 'the ownership check goes — the open relay behind the CORS error',
    file: 'index.ts',
    from: 'let canShare = doc.owner_id === me.id',
    to: 'let canShare = true',
    expect: 'no longer verifies that the caller owns the workspace',
  },
  {
    label: 'the template goes back inside the authorisation boundary',
    file: 'index.ts',
    from: "import { renderEmail, subjectFor } from './email-template.ts'",
    to: "function renderEmail() { return '' }\nfunction subjectFor() { return '' }",
    expect: 'does not import from ./email-template.ts',
  },
]

let caught = 0
let checked = 0
let skipped = 0

for (const brk of BREAKS) {
  const applied = patch(brk.file, brk.from, brk.to)
  if (applied.skip) {
    console.log(`SKIP  ${brk.label}\n      ${applied.skip}`)
    skipped += 1
    continue
  }
  const restore = applied.restore
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
      else console.log(`      ${out.split('\n').find((l) => l.startsWith('FAIL')) || ''}`.slice(0, 200))
    }
  } finally {
    restore()
  }
}

/*
 * Two breaks that move a file rather than edit one, so they cannot use patch().
 *
 * The first is the one that actually happened: a `config.toml` written inside the
 * function's own directory, which the CLI never reads. It sat there through a
 * deploy, every check passed, and the gateway went on verifying the JWT.
 *
 * The second is a root config with no [functions] section at all, which is what a
 * well-meaning tidy-up of supabase/config.toml looks like.
 */

const MOVES = [
  {
    label: 'a config.toml appears in the function directory, where the CLI ignores it',
    make: (dir) => {
      const local = path.join(dir, 'config.toml')
      const root = path.join(dir, '..', '..', 'config.toml')
      const rootText = fs.readFileSync(root, 'utf8')
      const section = rootText.match(/\[functions\.send-share-email\][\s\S]*$/m)[0]
      fs.writeFileSync(local, section, 'utf8')
      return () => fs.rmSync(local, { force: true })
    },
    expect: 'its own config.toml, which the CLI does not read',
  },
  {
    label: 'the [functions] section is dropped when the root config is tidied',
    make: (dir) => {
      const root = path.join(dir, '..', '..', 'config.toml')
      const original = fs.readFileSync(root, 'utf8')
      fs.writeFileSync(root, original.replace(/\[functions\.send-share-email\][\s\S]*$/m, ''), 'utf8')
      return () => fs.writeFileSync(root, original, 'utf8')
    },
    expect: 'no [functions.send-share-email] section',
  },
]

for (const move of MOVES) {
  let restore
  try {
    restore = move.make(dir)
  } catch (error) {
    console.log(`SKIP  ${move.label}\n      could not set it up: ${error.message}`)
    continue
  }
  checked += 1
  try {
    try {
      run()
      console.log(`  ${move.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes(move.expect)
      console.log(`  ${move.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (right) caught += 1
      else console.log(`      ${out.split('\n').find((l) => l.startsWith('FAIL')) || ''}`.slice(0, 200))
    }
  } finally {
    restore()
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)

/*
 * A skip is not a pass, and this file exists to prove that tests can fail.
 *
 * A break whose text has moved reports SKIP, which in a wall of green looks exactly
 * like a break that was caught -- and it is the state in which this guard is
 * testing nothing while reporting that it tested everything. It happened here: an
 * edit to the code invalidated a pattern, the break was skipped, and the run
 * printed "12 of 12" and exited 0.
 *
 * So a skip is counted and turned into a failure, with the number said out loud.
 * `scripts/test-share-email-guard-selfcheck.cjs` proves this branch is reachable by
 * making a break un-attemptable and requiring a non-zero exit.
 */
if (skipped > 0) {
  console.log(`${skipped} break(s) could not be attempted, so this run proves less than it looks.`)
}

console.log('every file restored.')
process.exit(caught === checked && skipped === 0 && checked > 0 ? 0 : 1)
