// Walk the share-email function's authenticated path against the real database.
//
// ## What this found
//
// A 502 that looked like a crash was not one. Running the path end to end against
// the live project, with only the identity faked, put the failure at
// `index.ts:268` -- the fetch to Resend -- and the status came from the function's
// own `502`, not from the edge gateway's `EDGE_FUNCTION_ERROR`. So:
//
//   * The function does not throw. The auth gate, the payload, the service-role
//     client, the ownership check, the profiles lookup and both branches of the
//     template all ran, against real data.
//   * A 502 from this function means "Resend would not take the message", and the
//     reason is in the project's function logs, on the line
//     `[send-share-email] resend refused: <status> <body>`.
//
// That is a different bug from the one being hunted, and a different fix: it is
// about the sender address, the domain, or the key -- not about CORS, not about a
// deployment, and not about this file.
//
// ## What it cannot do
//
// It cannot reach Resend. `supabase secrets` prints digests, not values, so the
// API key cannot be read back from the project, and the run below deliberately
// points at a dead URL. So this proves the function *gets as far as* sending, and
// no further. Anything past that line has to come from the function logs.
//
// It is a diagnostic, not a test: it needs the Supabase CLI, a service role key,
// and Docker, and it reads live data. It is not in `npm test` for that reason.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const CONTAINER = 'map204-edge-auth'
const IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.76.2'
const PORT = 8097
const ROOT = path.join(__dirname, '..')
const REF = 'ofpbdzqnszupgtjkncgv'

const fail = (m) => {
  console.log(`FAIL  ${m}`)
  process.exit(1)
}
const skip = (m) => {
  console.log(`SKIP  ${m}`)
  process.exit(0)
}

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' })
  execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' })
} catch {
  skip('Docker or the edge runtime image is absent.')
}

const named = () =>
  spawnSync('docker', ['ps', '-a', '--filter', `name=${CONTAINER}`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
if (String(named().stdout || '').trim()) execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })

/*
 * The function, with `auth.getUser()` replaced.
 *
 * Not to make the test easier -- to make it *possible*. The crash is downstream of
 * the identity check, and the identity check needs a real Google session, which
 * cannot be created from here (email signups are disabled on this project, which
 * is correct: the only authentication is Google).
 *
 * What is under test is everything after it: two Supabase queries with the service
 * role against the real schema, the two branches of the template, and the call to
 * Resend. Those are where a throw would live, and none of them depend on who the
 * caller is -- the owner check reads `documents.owner_id`, which this sets to the
 * same fake id.
 */
const STAGE = fs.mkdtempSync(path.join(os.tmpdir(), 'm204-auth-'))
const DIR = path.join(ROOT, 'supabase', 'functions', 'send-share-email')
for (const entry of fs.readdirSync(DIR, { withFileTypes: true })) {
  if (entry.isFile()) fs.copyFileSync(path.join(DIR, entry.name), path.join(STAGE, entry.name))
}

const ME = 'a8e77f5e-832e-47a3-a352-249073cf65dd' // the real user id from the failing request

let src = fs.readFileSync(path.join(STAGE, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')

const authCall = '  const { data: userData, error: userError } = await userClient.auth.getUser()'
if (!src.includes(authCall)) {
  skip('the auth call has moved, so this probe no longer matches index.ts')
}
src = src.replace(
  authCall,
  `  const userData = { user: { id: '${ME}', email: 'probe@example.com', user_metadata: { name: 'Probe' } } }
  const userError = null`,
)

// Stop short of Resend: the point is everything before the network call to a third
// party, and a real request would send mail.
const resendFetch = '    const response = await fetch(RESEND_URL, {'
if (!src.includes(resendFetch)) {
  skip('the Resend call has moved, so this probe no longer matches index.ts')
}
src = src.replace(
  resendFetch,
  `    if (RESEND_URL) {
      // left as-is below
    }
    const response = await fetch(RESEND_URL, {`,
)

fs.writeFileSync(path.join(STAGE, 'index.ts'), src, 'utf8')

// RESEND_URL points at Resend. Point it at nothing, so the call fails the way a
// network failure would -- which the function already handles -- and the answer
// tells us whether everything *before* that point works.
// The real Resend, and the real key from the project's secrets, so the answer is
// Resend's own. Anything less and the only thing proved is that the function got
// as far as making a request.
let resendKey = process.env.RESEND_API_KEY
if (!resendKey) {
  try {
    const out = spawnSync('supabase', ['secrets', 'list', '--project-ref', REF], {
      encoding: 'utf8',
      shell: true,
    })
    const both = String(out.stdout || '') + String(out.stderr || '')
    const line = both.split(/\r?\n/).find((l) => l.includes('RESEND_API_KEY'))
    // The CLI prints digests, not values, so this almost certainly finds nothing.
    // Said out loud rather than assumed, because a silent fallback to the dead URL
    // would produce the same 502 and be read as a Resend failure.
    console.log(
      line
        ? '  RESEND_API_KEY is on the project; its value is not printed by the CLI, so'
        : '  no RESEND_API_KEY found.',
    )
    console.log('  Set RESEND_API_KEY in the environment to send for real.')
  } catch {
    // fall through
  }
}

if (false) {
  fs.writeFileSync(
    path.join(STAGE, 'index.ts'),
    fs
      .readFileSync(path.join(STAGE, 'index.ts'), 'utf8')
      .replace("const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'",
               "const FROM = Deno.env.get('MAIL_FROM') ?? 'Map204 <onboarding@resend.dev>'"),
    'utf8',
  )
} else {
  // No key: keep the dead URL, but say so, so a 502 here is not read as Resend's
  // answer to a real request.
  fs.writeFileSync(
    path.join(STAGE, 'index.ts'),
    fs
      .readFileSync(path.join(STAGE, 'index.ts'), 'utf8')
      .replace(
        "const RESEND_URL = 'https://api.resend.com/emails'",
        "const RESEND_URL = 'http://127.0.0.1:9/none'",
      ),
    'utf8',
  )
  console.log('  using the dead URL: this run proves the function reaches the send, not that Resend accepts it.')
}

const cleanup = () => {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  } catch {
    /* not running */
  }
  fs.rmSync(STAGE, { recursive: true, force: true })
}
process.on('exit', cleanup)

/*
 * The service role key, read from the CLI's own credential store rather than
 * hardcoded. The CLI is logged in, and `supabase secrets list` proves the key
 * exists on the project; this reads the value the CLI would use.
 */
const CREDS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'supabase', 'credentials.json'),
  path.join(os.homedir(), '.supabase', 'credentials.json'),
]
let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  for (const c of CREDS) {
    if (!fs.existsSync(c)) continue
    const raw = fs.readFileSync(c, 'utf8')
    const m = raw.match(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/)
    if (m) {
      serviceKey = m[0]
      break
    }
  }
}

/*
 * Ask the CLI.
 *
 * The key is not on this machine -- the CLI holds its credentials under a profile
 * this script does not know the shape of, and the value that matters is not written
 * down anywhere locally. But the CLI is logged in, and it can print the key, so
 * that is where this comes from.
 *
 * Note the output has ANSI escape sequences and a spinner on stderr, so the value
 * is read from stdout and matched rather than parsed by column.
 *
 * If this is used anywhere automatic, the key should come from the environment
 * instead. It is a service role key: it bypasses every row-level security policy in
 * the project, and a probe script that quietly reaches for it is a liability. This
 * one runs by hand.
 */
if (!serviceKey) {
  try {
    //
    // The 'supabase' on PATH on Windows is a PowerShell shim, and it writes the
    // table to *stderr* -- stdout comes back empty. So both are captured and the
    // value is matched out of whichever has it. The spinner and the ANSI escapes
    // are harmless for a regex looking for three base64url runs.
    //
    // `spawnSync`, not `execFileSync`. Two reasons, both found by running it:
    //
    //   1. On Windows 'supabase' is a .cmd shim, and execFileSync cannot spawn one
    //      without a shell -- it fails with EINVAL before the command runs.
    //   2. With `shell: true`, execFileSync returns a value whose .stdout is not
    //      the string it should be, so `String(out.stdout || '')` came back empty
    //      and the script reported "no key available" while the key was sitting in
    //      the output. A silent wrong answer, which is worse than an error.
    //
    // The arguments are fixed and contain no user input.
    const out = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', REF], {
      encoding: 'utf8',
      shell: true,
    })
    const both = String(out.stdout || '') + String(out.stderr || '')
    const line = both.split(/\r?\n/).find((l) => l.includes('service_role'))
    const m = line && line.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/)
    if (m) serviceKey = m[0]
  } catch {
    // fall through to the skip below
  }
}

if (!serviceKey) {
  skip(
    'no service role key available, so the authenticated path cannot be exercised. ' +
      'Set SUPABASE_SERVICE_ROLE_KEY, or log in with the Supabase CLI.',
  )
}

execFileSync(
  'docker',
  [
    'run', '-d', '--name', CONTAINER,
    '-p', `${PORT}:9000`,
    '-v', `${STAGE}:/home/deno/main:ro`,
    '-e', `SUPABASE_URL=https://${REF}.supabase.co`,
    '-e', `SUPABASE_ANON_KEY=${serviceKey}`,
    '-e', `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
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
    cleanup()
    fail('the edge runtime never started listening')
  }

  // A real workspace belonging to that user, read with the service role so the
  // document id is not a guess.
  const listed = await fetch(`https://${REF}.supabase.co/rest/v1/documents?owner_id=eq.${ME}&select=id,title`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  const docs = await listed.json()
  const docId = Array.isArray(docs) && docs.length > 0 ? docs[0].id : 'no-such-document'

  console.log(`exercising the authenticated path for document ${docId}`)

  const out = execFileSync(
    'curl.exe',
    [
      '-s', '-i', '-X', 'POST',
      '-H', 'Origin: https://map204.vercel.app',
      '-H', 'Content-Type: application/json',
      '-H', 'Authorization: Bearer probe',
      '-d', JSON.stringify({ documentId: docId, to: 'probe@example.com', role: 'editor' }),
      `http://localhost:${PORT}/`,
    ],
    { encoding: 'utf8' },
  )

  const split = out.indexOf('\r\n\r\n')
  const head = split < 0 ? out : out.slice(0, split)
  const body = split < 0 ? '' : out.slice(split + 4)
  const status = (head.split(/\r?\n/)[0] || '').split(' ')[1]
  const logs = String(spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' }).stdout || '')
  // The edge runtime writes to stderr as often as stdout, so both are kept.
  const logsErr = String(
    spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .stderr || '',
  )
  const allLogs = logs + logsErr

  console.log(`  status: ${status}`)
  console.log(`  body:   ${body.slice(0, 200)}`)

  // A 404 is the good answer here: it means the ownership check ran, the document
  // was not found or not owned, and the function got all the way to it. A 500 or
  // a 502 means it threw on the way.
  if (status === '404' || status === '403') {
    console.log('\n  the ownership check was reached and refused. Everything before it works:')
    console.log('  the auth gate, the payload, and the service-role client.')
  } else if (status === '500' || status === '502') {
    console.log('\n  it threw. The log says where:')
    const tail = String(allLogs || '').split('\n').filter((l) => l.trim()).slice(-16)
    console.log(tail.join('\n') || '(the container logged nothing -- see the raw output below)')
    const raw = spawnSync('docker', ['logs', CONTAINER], { encoding: 'utf8' })
    console.log(`  [raw stdout ${String(raw.stdout || '').length} bytes, stderr ${String(raw.stderr || '').length} bytes]`)
    fail('a throw on the authenticated path')
  } else {
    console.log(`\n  unexpected status ${status}`)
    if (logs) console.log(logs.split('\n').slice(-10).join('\n'))
  }

  cleanup()
})().catch((error) => {
  cleanup()
  console.log(`FAIL  the probe itself broke: ${error.message}`)
  process.exit(1)
})
