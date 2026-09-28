// Version 1 into version 2.
//
// The migration is the only reason a format change is survivable: it is what
// stands between an export somebody took months ago and a file the app can open.
// That makes it the one piece of this work where being wrong destroys data
// quietly, so it is tested for what it *drops* as much as for what it keeps.
//
// Three properties matter, and they are different:
//
//   1. Nothing that can be translated is lost. Every version 1 card kind becomes
//      an element of the right kind, with its text, its link and its geometry.
//   2. A version 1 card's fields that belonged to *other* kinds are not carried
//      over. This is the whole point of the change — a video element that still
//      has an `image` is the old model wearing a new name — and it is the
//      assertion that is easiest to write and easiest to get wrong.
//   3. Anything that *cannot* be translated is dropped loudly, never invented.
//      A file that got a plausible-looking element for a card it could not read
//      is worse than a file that says so.
//
// The store is not involved; `migrateToV2` is run for real, on real version 1
// shapes, because a copy of the translation rules would agree with itself.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'))
const bundle = path.join(dir, 'migrate.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/elements/migrate.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle the migration: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const script = `
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL(process.argv[2]).href)

const failures = []
const fail = (msg) => failures.push(msg)

const card = (over) => ({
  id: 'c1',
  type: 'note',
  title: 'A card',
  content: 'Some text',
  image: { src: null, alt: '' },
  position: { x: 10, y: 20, width: 300, height: 150, zIndex: 3 },
  style: { backgroundColor: '#eee', borderRadius: 4 },
  tags: ['a'],
  collapsed: false,
  parentId: null,
  checklist: [{ id: 'i1', text: 'step', done: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  embed: null,
  ...over,
})

const page = (over) => ({
  id: 'p1',
  title: 'Page one',
  position: { x: 0, y: 0 },
  viewport: { x: 5, y: 6, zoom: 1.5 },
  cards: [],
  groups: [],
  connections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const run = (doc) => m.migrateToV2(doc)

/* --- the version and the shape ------------------------------------- */
const basic = run({ version: 1, pages: [page({ cards: [card({})] })] })
if (basic.doc.version !== 2) fail(\`the version stayed \${basic.doc.version}\`)
if (basic.doc.pages.length !== 1) fail('the page was lost')
if (!('elements' in basic.doc.pages[0])) {
  fail('the page has no elements: it still uses the old cards key')
}
if ('cards' in basic.doc.pages[0]) fail('the page still has a cards key')

/* --- a note --------------------------------------------------------- */
const note = basic.doc.pages[0].elements[0]
if (note.kind !== 'note') fail(\`a note became "\${note.kind}"\`)
if (note.title !== 'A card') fail(\`the title was lost: \${note.title}\`)
if (note.body !== 'Some text') fail(\`the body was lost: \${note.body}\`)
if (note.body === undefined && note.content === undefined) fail('there is no text field at all')
if (note.content !== undefined) fail('a version 2 note still has a content field')

// Geometry flattened onto the base.
if (note.x !== 10 || note.y !== 20 || note.width !== 300 || note.height !== 150) {
  fail(\`the geometry was not flattened: \${JSON.stringify({
    x: note.x, y: note.y, width: note.width, height: note.height,
  })}\`)
}
if (note.zIndex !== 3) fail(\`z-index was lost: \${note.zIndex}\`)

// And the note's own things survived.
if (note.style.backgroundColor !== '#eee') fail('the style was lost')
if (note.style.borderRadius !== 4) fail('the style was not merged with the defaults')
if (note.checklist.length !== 1 || note.checklist[0].text !== 'step') fail('the checklist was lost')
if (note.tags[0] !== 'a') fail('the tags were lost')

/* --- a video --------------------------------------------------------- */
const video = run({
  version: 1,
  pages: [page({ cards: [card({
    type: 'youtube',
    title: 'Untitled',
    content: '',
    embed: { url: 'https://youtu.be/dQw4w9WgXcQ?t=90', meta: { start: 90 } },
  })] })],
}).doc.pages[0].elements[0]
if (video.kind !== 'video') fail(\`a video became "\${video.kind}"\`)
if (video.url !== 'https://youtu.be/dQw4w9WgXcQ?t=90') fail('the video lost its link')
if (video.embed !== undefined) fail('a version 2 video still has an embed wrapper')
if (video.keepAspect !== true) fail('a video does not keep its aspect ratio by default')
if (video.startSeconds !== 90) fail(\`the timestamp was lost: \${video.startSeconds}\`)

// The point of the whole change. A video has no body, no checklist, no image,
// no style — there is nowhere in version 2 to put them.
for (const field of ['body', 'content', 'checklist', 'tags', 'image', 'style', 'title2']) {
  if (field in video) fail(\`a video carried a note's field: \${field}\`)
}

/* --- a flash card becomes a deck of one ----------------------------- */
const flash = run({
  version: 1,
  pages: [page({ cards: [card({ type: 'flash', title: 'Q?', content: 'the answer' })] })],
}).doc.pages[0].elements[0]
if (flash.kind !== 'flash') fail(\`a flash card became "\${flash.kind}"\`)
if (!Array.isArray(flash.cards)) fail('a flash card is not a deck')
if (flash.cards.length !== 1) fail(\`a single flash card became a deck of \${flash.cards.length}\`)
if (flash.cards[0].length !== 2) fail(\`a flash card became \${flash.cards[0].length} sides\`)
if (flash.cards[0][0].text !== 'Q?') fail(\`the question was lost: \${flash.cards[0][0].text}\`)
if (!flash.cards[0][1].text) fail('the answer was lost')
if (flash.hideAnswer !== true) fail('a flash card does not hide its answer by default')

/* --- a pdf ----------------------------------------------------------- */
const pdf = run({
  version: 1,
  pages: [page({ cards: [card({ type: 'pdf', title: 'Lecture', embed: { url: 'https://x.test/a.pdf' } })] })],
}).doc.pages[0].elements[0]
if (pdf.kind !== 'pdf') fail(\`a pdf became "\${pdf.kind}"\`)
if (pdf.url !== 'https://x.test/a.pdf') fail('the pdf lost its link')
if (pdf.file !== null) fail('a version 1 pdf came out with an uploaded file, which cannot exist')
if (pdf.display !== 'chip') fail(\`a pdf defaults to "\${pdf.display}", expected a chip\`)

/* --- groups and connections are re-pointed -------------------------- */
const linked = run({
  version: 1,
  pages: [page({
    cards: [card({ id: 'a' }), card({ id: 'b', title: 'Second' })],
    groups: [{
      id: 'g1',
      title: 'Group',
      position: { x: 0, y: 0, width: 500, height: 400, zIndex: 0 },
      color: '#123456',
      memberCardIds: ['a', 'b'],
      memberGroupIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    connections: [{
      id: 'l1',
      source: { kind: 'card', id: 'a' },
      target: { kind: 'card', id: 'b' },
      label: 'leads to',
      relationshipType: 'causes',
      style: {},
      sourceAnchor: null,
      targetAnchor: null,
    }],
  })],
}).doc.pages[0]
if (linked.groups.length !== 1) fail('the group was lost')
if (linked.groups[0].memberIds.length !== 2) {
  fail(\`the group's members were lost: \${linked.groups[0].memberIds.length}\`)
}
if (linked.groups[0].color !== '#123456') fail('the group lost its colour')
if (linked.connections.length !== 1) fail('the connection was lost')
if (linked.connections[0].relationshipType !== 'causes') fail('the connection lost its relationship')
if (linked.connections[0].source.kind !== 'element') {
  fail(\`a connection to a card is now "\${linked.connections[0].source.kind}"\`)
}

/* --- a connection's *style* survives, not just its endpoints ------------ */
//
// A connection that kept its endpoints but lost its routing would look correct
// in a test about endpoints and be wrong on the canvas. This happened: version 1
// called the right-angled routing "stepped" and the migration only knew the new
// name, so every stepped connection in every saved document quietly became a
// curve.
const styled = run({
  version: 1,
  pages: [{
    id: 'p1',
    title: 'T',
    // Real cards, because a connection to a card that is not there is dropped —
    // which is the correct behaviour and would otherwise look like a failure of
    // the style assertions below.
    cards: [
      { id: 'a', type: 'note', title: 'A', content: '', style: {}, tags: [], checklist: [],
        position: { x: 0, y: 0, width: 200, height: 100, zIndex: 1 },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', type: 'note', title: 'B', content: '', style: {}, tags: [], checklist: [],
        position: { x: 400, y: 0, width: 200, height: 100, zIndex: 2 },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c', type: 'note', title: 'C', content: '', style: {}, tags: [], checklist: [],
        position: { x: 0, y: 300, width: 200, height: 100, zIndex: 3 },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    groups: [],
    connections: [
      { id: 'c1', source: { kind: 'card', id: 'a' }, target: { kind: 'card', id: 'b' },
        label: '', relationshipType: 'related to', sourceAnchor: null, targetAnchor: null,
        style: { routing: 'stepped', lineStyle: 'dashed', arrowStart: 'none', arrowEnd: 'diamond' } },
      { id: 'c2', source: { kind: 'card', id: 'a' }, target: { kind: 'card', id: 'c' },
        label: '', relationshipType: 'related to', sourceAnchor: null, targetAnchor: null,
        style: { routing: 'straight', lineStyle: 'solid', arrowStart: 'circle', arrowEnd: 'arrow' } },
    ],
  }],
}).doc.pages[0].connections

if (styled[0].style.routing !== 'orthogonal') {
  fail(\`a stepped connection became "\${styled[0].style.routing}"\`)
}
if (styled[0].style.lineStyle !== 'dashed') fail('a dashed line became solid')
if (styled[0].style.arrowEnd !== 'diamond') {
  fail(\`a diamond arrowhead became "\${styled[0].style.arrowEnd}"\`)
}
if (styled[1].style.routing !== 'straight') fail('a straight connection changed routing')
if (styled[1].style.arrowStart !== 'circle') {
  fail(\`a circle arrowhead became "\${styled[1].style.arrowStart}"\`)
}

/* --- a card's parentId is reported, not swallowed --------------------- */
//
// Version 1 had two ways to say "this is inside that": a card's parentId, and a
// group's memberCardIds. Version 2 has one. A parentId with no group behind it is
// a relationship that cannot survive, and every other lossy case in the
// migration says so — this one was silent, which meant a person could open their
// document and find the structure gone with no idea whether they had done
// something wrong.
const v1Card = (over) => ({
  id: 'x',
  type: 'note',
  title: 'T',
  content: '',
  style: {},
  tags: [],
  checklist: [],
  position: { x: 0, y: 0, width: 200, height: 100, zIndex: 1 },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const parented = run({
  version: 1,
  pages: [{
    id: 'p1',
    title: 'P',
    cards: [v1Card({ id: 'a' }), v1Card({ id: 'b', parentId: 'a' })],
    groups: [],
  }],
})
if (parented.doc.pages[0].elements.length !== 2) {
  fail(\`a parented card was dropped: \${parented.doc.pages[0].elements.length} elements\`)
}
if (!parented.warnings.some((w) => w.includes('inside another'))) {
  fail(\`a lost parentId produced no warning: \${JSON.stringify(parented.warnings)}\`)
}

// The same shape, but a group claims the child too — so the containment
// survives and there is nothing to report. A warning here would be noise about a
// document that is fine.
const alsoGrouped = run({
  version: 1,
  pages: [{
    id: 'p1',
    title: 'P',
    cards: [v1Card({ id: 'a' }), v1Card({ id: 'b', parentId: 'a' })],
    groups: [{
      id: 'g1',
      title: 'G',
      position: { x: 0, y: 0, width: 400, height: 300, zIndex: 0 },
      color: '#123456',
      memberCardIds: ['a', 'b'],
      memberGroupIds: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  }],
})
if (alsoGrouped.warnings.some((w) => w.includes('inside another'))) {
  fail('a parentId that a group also claims was reported as lost')
}
if (alsoGrouped.doc.pages[0].groups[0].memberIds.length !== 2) {
  fail('the group lost its members')
}

/* --- things that cannot be translated are dropped, loudly ------------ */
const broken = run({
  version: 1,
  pages: [page({
    cards: [
      card({ id: 'ok', type: 'note' }),
      card({ id: 'weird', type: 'hologram' }),
      // A video with no usable link has nothing to point at, so it is not a
      // video element — it is a card the file got wrong.
      card({ id: 'nolink', type: 'youtube', embed: { url: 'https://vimeo.com/1' } }),
    ],
  })],
})
if (broken.doc.pages[0].elements.length !== 1) {
  fail(\`expected 1 surviving element, got \${broken.doc.pages[0].elements.length}\`)
}
if (broken.doc.pages[0].elements[0].title !== 'A card') fail('the wrong element survived')
if (broken.warnings.length < 2) {
  fail(\`two cards were dropped but only \${broken.warnings.length} warning(s) were given\`)
}
for (const w of broken.warnings) {
  if (!/hologram|video|kind|nothing to show/i.test(w)) {
    fail(\`a warning does not say what was dropped: \${w}\`)
  }
}

/* --- a connection to a card that is not there ------------------------ */
const dangling = run({
  version: 1,
  pages: [page({
    cards: [card({ id: 'a' })],
    connections: [{
      id: 'l1',
      source: { kind: 'card', id: 'a' },
      target: { kind: 'card', id: 'missing' },
      label: '',
      relationshipType: '',
      style: {},
    }],
  })],
})
if (dangling.doc.pages[0].connections.length !== 0) {
  fail('a connection to a missing card was kept, pointing at nothing')
}
if (!dangling.warnings.some((w) => /connection/i.test(w))) {
  fail('dropping a dangling connection was silent')
}

/* --- rubbish input --------------------------------------------------- */
for (const junk of [null, undefined, 42, 'a string', [], {}, { version: 1 }, { version: 1, pages: 'no' }]) {
  const out = run(junk)
  if (!out.doc || out.doc.version !== 2) fail(\`junk input gave \${JSON.stringify(out.doc)?.slice(0, 80)}\`)
  if (!Array.isArray(out.doc.pages)) fail('junk input gave no pages array')
  if (!Array.isArray(out.doc.settings.steps)) fail('junk input gave no steps array')
}

// A file already at the current version is left alone. Re-running the migration
// on it would double-convert, which is the failure mode of a function that
// always does its work.
const already = { version: 2, pages: [page()], settings: {}, uploadBytes: 7 }
const through = run(already)
if (through.doc.uploadBytes !== 7) fail('a version 2 file was re-migrated')
if (through.notes.length !== 0) fail('a version 2 file produced migration notes')

/* --- an already-current file is not downgraded ----------------------- */
const future = run({ version: 3, pages: [], settings: {} })
if (future.doc.version !== 3) fail('a newer file was rewritten to an older version')

/* --- the quota -------------------------------------------------------- */
if (m.MAX_UPLOAD_BYTES !== 50 * 1024 * 1024) {
  fail(\`the upload limit is \${m.MAX_UPLOAD_BYTES}, expected 50Mb\`)
}
const after = run({ version: 1, pages: [page({ cards: [card({})] })] })
if (after.doc.uploadBytes !== 0) fail('a migrated document did not start with an empty quota')

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
    'migration: every version 1 kind becomes its own element with nothing extra, untranslatable cards are dropped loudly, old links keep working',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
