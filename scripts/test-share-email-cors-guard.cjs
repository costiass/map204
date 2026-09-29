// Prove scripts/test-share-email-cors.cjs fails when the CORS handling regresses.
//
// The first two breaks are the bug that was actually reported -- the preflight
// answered 405, and no response carrying an Access-Control-Allow-Origin. The rest
// are the realistic ways it comes back: a new early return that forgets the helper,
// an origin echoed instead of checked, and the gateway configuration lost on a
// redeploy.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'send-share-email')
const TEST = path.join(__dirname, 'test-share-email-cors.cjs')

const run = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Patch a file, ignoring line endings, and hand back a restore. */
function patch(file, from, to) {
  const full = path.join(dir, file)
  const original = fs.readFileSync(full, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')
  if (!lf.includes(from)) return null
  const crlf = original.includes('\r\n')
  fs.writeFileSync(full, (crlf ? lf.replace(from, to).replace(/\n/g, '\r\n') : lf.replace(from, to)), 'utf8')
  return () => fs.writeFileSync(full, original, 'utf8')
}

const BREAKS = [
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
      console.log(`  ${brk.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (right) caught += 1
      else console.log(`      ${out.split('\n').find((l) => l.startsWith('FAIL')) || ''}`.slice(0, 200))
    }
  } finally {
    restore()
  }
}

// The seventh break deletes a file, so it is done last and restored by hand.
{
  const config = path.join(dir, 'config.toml')
  const original = fs.readFileSync(config, 'utf8')
  fs.rmSync(config)
  try {
    try {
      run()
      console.log('  the gateway config is gone\n      PASSED -- the test does NOT cover this')
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes('there is no config.toml')
      console.log(`  the gateway config is gone\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (right) caught += 1
    }
  } finally {
    fs.writeFileSync(config, original, 'utf8')
  }
  checked += 1
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
console.log('every file restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
