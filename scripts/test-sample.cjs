// Does the bundled tutorial document actually survive the migration?
//
// `src/data/sample.ts` is written as a **version 1** document and migrated on the
// way out, so that the migration is exercised on the first screen a new user
// sees. That is only a good idea if the migration is right, and `test-migrate-v2`
// proves the migration against hand-written fixtures — which cannot catch a
// fixture that has drifted away from the real thing.
//
// So this runs the *actual* sample through the *actual* migration and checks the
// result has the shape the canvas needs: real elements, real kinds, flat
// geometry, connections that point at things that exist.
//
// Run: node scripts/test-sample.cjs

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sample-'))
const bundle = path.join(dir, 'sample.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/data/sample.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle the sample: ${error.stderr ?? error.message}`)
  process.exit(1)
}

// A file rather than `node -e`, so the bundle arrives as `process.argv[2]`.
// With `-e` the argument positions shift and the path comes back undefined —
// which is a confusing way to learn that.
const runner = path.join(dir, 'run.mjs')
fs.writeFileSync(
  runner,
  `import { pathToFileURL } from 'node:url'
const { createSampleDoc } = await import(pathToFileURL(process.argv[2]).href)
process.stdout.write(JSON.stringify(createSampleDoc()))
`,
)

let raw
try {
  raw = execFileSync(process.execPath, [runner, bundle], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
} catch (error) {
  console.log(`FAIL  the sample threw: ${error.stderr ?? error.message}`)
  process.exit(1)
}

let doc
try {
  doc = JSON.parse(raw)
} catch {
  console.log('FAIL  the sample did not produce a document')
  process.exit(1)
}

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('sample: the bundled tutorial, migrated for real\n')

check('is version 2', doc.version === 2, `version ${doc.version}`)
check('has pages', Array.isArray(doc.pages) && doc.pages.length >= 2, `${doc.pages?.length}`)
check('has settings', doc.settings !== undefined)

// --- every element is a real, complete element of a declared kind ----------

const KINDS = new Set(['note', 'video', 'flash', 'pdf', 'link', 'table'])
let elements = 0
let badKind = ''
let missingGeometry = ''
let nestedPosition = ''
let badTimestamp = ''

for (const page of doc.pages) {
  check(`page "${page.title}" has an ordinal`, typeof page.ordinal === 'number')
  for (const element of page.elements) {
    elements += 1
    if (!KINDS.has(element.kind)) badKind = `${element.id}: ${element.kind}`
    if (
      typeof element.x !== 'number' ||
      typeof element.y !== 'number' ||
      typeof element.width !== 'number' ||
      typeof element.height !== 'number' ||
      typeof element.zIndex !== 'number'
    ) {
      missingGeometry = `${element.id}: ${JSON.stringify(element).slice(0, 90)}`
    }
    if (element.position !== undefined) nestedPosition = element.id
    if (typeof element.createdAt !== 'string' || typeof element.updatedAt !== 'string') {
      badTimestamp = element.id
    }
  }
}

check('every element has a declared kind', badKind === '', badKind)
check('every element has flat geometry', missingGeometry === '', missingGeometry)
check('no element kept a nested `position`', nestedPosition === '', nestedPosition)
check('every element has timestamps', badTimestamp === '', badTimestamp)
// Exactly, not "at least". A sample that quietly loses an element is precisely
// what this test exists to catch, and a `>=` bound would not notice.
check('every sample card survived', elements === 7, `${elements} elements, expected 7`)

// --- a note carries its body; a video carries an id -----------------------

const allElements = doc.pages.flatMap((p) => p.elements)
const notes = allElements.filter((e) => e.kind === 'note')
check('notes kept their Markdown', notes.every((n) => typeof n.body === 'string'))
check('notes kept their style', notes.every((n) => n.style && n.style.backgroundColor))
check('notes kept their checklist', notes.every((n) => Array.isArray(n.checklist)))

// --- flash cards became decks of one --------------------------------------

const flashes = allElements.filter((e) => e.kind === 'flash')
check(
  'a flash card became a deck of one, with the title as the question',
  flashes.every(
    (f) =>
      f.cards.length === 1 &&
      f.cards[0].length === 2 &&
      f.cards[0][0].text.length > 0 &&
      f.cardIndex === 0,
  ),
  JSON.stringify(flashes[0] ?? null).slice(0, 120),
)

// --- nothing points at nothing --------------------------------------------

let dangling = ''
for (const page of doc.pages) {
  const ids = new Set([
    ...page.elements.map((e) => e.id),
    ...page.groups.map((g) => g.id),
  ])
  for (const group of page.groups) {
    for (const member of group.memberIds) {
      if (!ids.has(member)) dangling = `group member ${member}`
    }
  }
  for (const connection of page.connections) {
    if (!ids.has(connection.source.id)) dangling = `source ${connection.source.id}`
    if (!ids.has(connection.target.id)) dangling = `target ${connection.target.id}`
  }
}
check('no connection or group member points at nothing', dangling === '', dangling)

// --- the connections are still there --------------------------------------

const connectionCount = doc.pages.reduce((n, p) => n + p.connections.length, 0)
check('the tutorial still has its connections', connectionCount >= 4, `${connectionCount}`)

// Every connection in the sample names an anchor, because the author chose one.
// A migration that dropped them would redraw the whole tutorial differently on
// first open, and every connection would still *look* fine — which is why this
// is asserted rather than assumed.
const anchored = doc.pages.flatMap((p) => p.connections).filter((c) => c.sourceAnchor !== null)
check(
  'connections kept the anchor the author chose',
  anchored.length >= 4,
  `${anchored.length} of ${connectionCount} kept an anchor`,
)
check(
  'every anchor is a side a box has',
  doc.pages
    .flatMap((p) => p.connections)
    .every((c) =>
      [c.sourceAnchor, c.targetAnchor].every(
        (a) => a === null || ['top', 'right', 'bottom', 'left'].includes(a),
      ),
    ),
)

console.log(
  failures === 0
    ? '\nsample: a version 1 document reaches the canvas as a valid version 2 one'
    : `\nsample: ${failures} check(s) failed`,
)
process.exit(failures === 0 ? 0 : 1)
