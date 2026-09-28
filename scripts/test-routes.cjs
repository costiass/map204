// Addresses, and the ones that used to be.
//
// A route is not a string that happens to work: it ends up in a bookmark, in a
// message somebody sends, in a screenshot. Renaming one is therefore a promise
// about links that have already left the building, and the only safe way to make
// one is to keep answering the old one.
//
// This asserts both halves. That `/doc/…` is what we now generate, and that
// `/w/…` still resolves to the same document rather than becoming a 404 —
// because a 404 for a link that used to work is how a rename costs somebody
// access to a document that is still sitting in the database, perfectly fine.
//
// `parse` is run for real. A copy of the path patterns would agree with itself
// no matter what the router did.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'))
const bundle = path.join(dir, 'router.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/router.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle src/router.ts: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const script = `
import { pathToFileURL } from 'node:url'

const m = await import(pathToFileURL(process.argv[2]).href)
const failures = []
const fail = (msg) => failures.push(msg)

const id = 'abc-123'

/* --- the address we generate ----------------------------------------- */
const generated = m.workspacePath(id)
if (generated !== '/doc/' + id) fail(\`workspacePath gave "\${generated}"\`)
if (generated.includes('/w/')) fail('workspacePath still generates the old path')

if (m.HOME_PATH !== '/') fail(\`HOME_PATH is "\${m.HOME_PATH}"\`)
if (m.SETTINGS_PATH !== '/settings') fail(\`SETTINGS_PATH is "\${m.SETTINGS_PATH}"\`)

// An id containing a slash must not be able to forge a path segment, or a
// document with a slash in its name becomes a different page entirely.
const nasty = m.workspacePath('a/../settings')
if (nasty.includes('/../')) fail(\`an id escaped its path segment: "\${nasty}"\`)
// …and what we generate must survive our own parser unchanged.
if (m.parse(nasty).name !== 'workspace') {
  fail(\`a generated address did not parse back to a document: "\${nasty}"\`)
}

/* --- every address, and what it resolves to -------------------------- */
const cases = [
  ['/', 'home'],
  ['', 'home'],
  ['/settings', 'settings'],
  ['/settings/', 'settings'],

  // The new address.
  ['/doc/' + id, 'workspace'],
  ['/doc/' + id + '/', 'workspace'],

  // The old address still opens the same document, and is flagged as old so the
  // bar gets tidied. A 404 here would be a link somebody already sent you.
  ['/w/' + id, 'workspace'],
  ['/w/' + id + '/', 'workspace'],

  // Genuinely nothing.
  ['/nope', 'not-found'],
  ['/doc', 'not-found'],
  ['/doc/', 'not-found'],
  ['/doc/a/b', 'not-found'],
  ['/docx/' + id, 'not-found'],
  ['/w', 'not-found'],
  ['/w/', 'not-found'],
  ['/settings/extra', 'not-found'],
]

for (const [pathname, expected] of cases) {
  const route = m.parse(pathname)
  if (route.name !== expected) {
    fail(\`"\${pathname}" resolved to "\${route.name}", expected "\${expected}"\`)
  }
  // A document's id must survive the round trip, or the workspace that opens is
  // not the workspace the link named.
  if (route.name === 'workspace' && route.docId !== id) {
    fail(\`"\${pathname}" gave docId "\${route.docId}"\`)
  }
}

/* --- only the old address is marked old ------------------------------ */
if (m.parse('/w/' + id).legacy !== true) {
  fail('the old address is not flagged for tidying, so it stays in the bar')
}
for (const [pathname] of cases) {
  if (pathname.startsWith('/w/')) continue
  if (m.parse(pathname).legacy) fail(\`"\${pathname}" was wrongly flagged as a legacy address\`)
}

/* --- the old and the new name the same document ---------------------- */
// The whole point of keeping the old path alive: the two are the same document.
if (m.parse('/w/' + id).docId !== m.parse(generated).docId) {
  fail('the old address names a different document than the new one')
}

process.stdout.write(JSON.stringify(failures))
`

let failures = []
try {
  const scriptFile = path.join(dir, 'checks.mjs')
  fs.writeFileSync(scriptFile, script)
  const output = execFileSync(process.execPath, [scriptFile, bundle], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  failures = JSON.parse(output)
} catch (error) {
  console.log(`FAIL  the checks could not run: ${error.stderr ?? error.message}`)
  process.exit(1)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

for (const message of failures) console.log(`FAIL  ${message}`)

if (failures.length === 0) {
  console.log(
    'routes: /doc/ is what we generate, /w/ still opens the same document, anything else is a 404',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
