// Reading elements out of untrusted JSON.
//
// `normalizeDoc` is the one place that decides what a document *is*. Everything
// untrusted arrives through it: a file somebody imported, a realtime message from
// a collaborator, a row read back from the database. So the two properties worth
// asserting are opposites, and both matter.
//
//   1. Nothing valid is lost. A missing field gets a default, not an omission.
//   2. Nothing invalid is trusted. The numbers that move a camera, the counts
//      that decide how big a table draws, the ids a group points at — a file that
//      gets these wrong fails *visibly* at best and silently at worst.
//
// The failure mode this file is guarding is the one `test-drift-detection` was
// built for: a check that passes while checking nothing. So every assertion here
// names a value, not just that a function returned.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elems-'))
const bundle = path.join(dir, 'serialize.mjs')
// `defaults` is bundled separately rather than reached through serialize, because
// the assertions below compare the title bar's height against the arithmetic that
// uses it, and that comparison is only meaningful if both numbers come from the
// code. A test that hard-codes the constant is asserting against its own memory.
const defaultsBundle = path.join(dir, 'defaults.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/elements/serialize.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/elements/defaults.ts', '--format', 'esm', '--file', defaultsBundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle src/elements: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const script = `
import { pathToFileURL } from 'node:url'
const m = await import(pathToFileURL(process.argv[2]).href)
const d = await import(pathToFileURL(process.argv[3]).href)

const failures = []
const fail = (msg) => failures.push(msg)

/* --- an empty document ---------------------------------------------- */
const empty = m.normalizeDoc(undefined)
if (empty.version !== 2) fail(\`version is \${empty.version}\`)
if (!Array.isArray(empty.pages)) fail('no pages array')
if (!Array.isArray(empty.settings.steps)) fail('no steps array')
if (empty.uploadBytes !== 0) fail(\`uploadBytes is \${empty.uploadBytes}\`)
if (!empty.settings.defaultNoteStyle.backgroundColor) fail('no default note style')

/* --- rubbish in every field ---------------------------------------- */
for (const junk of [null, 42, 'x', [], {}, { pages: 'no' }, { pages: [null, 3, 'x'] }]) {
  const doc = m.normalizeDoc(junk)
  if (doc.version !== 2) fail(\`junk gave version \${doc.version}\`)
  if (!Array.isArray(doc.pages)) fail('junk gave no pages array')
}

/* --- every kind, from nothing --------------------------------------- */
for (const kind of ['note', 'video', 'flash', 'pdf', 'link', 'table']) {
  const element = m.createElement(kind, {}, { x: 100, y: 200 })
  if (element.kind !== kind) fail(\`createElement('\${kind}') made a "\${element.kind}"\`)
  if (element.x !== 100 || element.y !== 200) fail(\`\${kind} was not placed where asked\`)
  if (!element.id) fail(\`\${kind} has no id\`)
  if (!Number.isFinite(element.width) || element.width <= 0) fail(\`\${kind} has no width\`)
  if (!Number.isFinite(element.height) || element.height <= 0) fail(\`\${kind} has no height\`)
  if (!Number.isFinite(element.zIndex)) fail(\`\${kind} has no zIndex\`)
  // It must survive a round trip through the file format unchanged in kind.
  const back = m.normalizeElement(JSON.parse(JSON.stringify(element)))
  if (back.kind !== kind) fail(\`a \${kind} came back as a "\${back.kind}"\`)
}

/* --- a video's size comes from its aspect, plus its title bar --------- */
//
// The element's height covers the title bar *and* the video, so the arithmetic is
//
//   height = header + width / aspect
//
// and not width / aspect. Sizing the element to the video's shape alone gives a
// box exactly the right size for the video and then squeezes the video into
// whatever the title bar left -- so every video is letterboxed by the height of
// its own header, and the height stored in the model is not the height on screen.
//
// HEADER below is read from the bundle's own constants rather than written out,
// because the number that matters is the one the code uses. Whether it agrees
// with the stylesheet is a separate question, answered by test-element-chrome.cjs.
const HEADER = d.ELEMENT_HEADER_HEIGHT
if (typeof HEADER !== 'number' || HEADER <= 0) {
  fail(\`the bundle has no usable ELEMENT_HEADER_HEIGHT, got \${HEADER}\`)
}

const bodyAspectOf = (v) => (v.width / (v.height - HEADER))
const video = m.createElement('video', {}, { x: 0, y: 0 })
if (Math.abs(bodyAspectOf(video) - video.aspect) > 0.02) {
  fail(
    \`a new video is \${video.width}x\${video.height}, whose body is not its \` +
      \`\${video.aspect} shape once the \${HEADER}px title bar is taken off\`,
  )
}

/* --- a video that cannot play is not left looking playable ------------ */
//
// A video element is a promise that something will play. Given a URL that is not
// a video, that promise is false, and the element has to say so rather than
// render a black rectangle that never resolves.
//
// This used to be \`embedFor\` downgrading the card to a note. The downgrade is
// gone — a video element stays a video element — so what is asserted here is the
// narrower and more useful claim: the element records that it has nothing to
// play, so the renderer can show that instead of a blank frame.
const notAVideo = m.normalizeElement({
  kind: 'video',
  url: 'https://example.com/not-a-video',
  width: 400,
  height: 300,
})
if (notAVideo.kind !== 'video') {
  fail(\`a video with a non-video URL changed kind to "\${notAVideo.kind}"\`)
}
if (notAVideo.url !== 'https://example.com/not-a-video') {
  fail('the URL was dropped rather than kept for the renderer to judge')
}
// A video with no URL at all is the more common case, and it must be
// distinguishable from one that has a URL that happens to be unplayable.
const emptyVideo = m.normalizeElement({ kind: 'video', width: 400, height: 300 })
if (emptyVideo.url !== '') fail(\`a video with no URL got "\${emptyVideo.url}"\`)

/* --- a new video is created at the shape it is given ---------------- */
//
// Every video used to be created 16:9 whatever it held, because the maker had
// no idea what the video was until its thumbnail loaded - and the renderer then
// *covered* the box with that thumbnail, so a 4:3 video lost its sides and a
// tall one lost its top. A caller that knows the shape gets a box of that shape.
const widescreen = m.createElement('video', {}, { x: 0, y: 0 })
if (Math.abs(bodyAspectOf(widescreen) - 16 / 9) > 0.02) {
  fail(\`a video with no known shape is \${widescreen.width}x\${widescreen.height}\`)
}
const fourThree = m.createElement('video', { aspect: 4 / 3 }, { x: 0, y: 0 })
if (Math.abs(bodyAspectOf(fourThree) - 4 / 3) > 0.02) {
  fail(\`a 4:3 video was created \${fourThree.width}x\${fourThree.height}\`)
}
// A nonsense shape is refused rather than producing a box nobody can see.
for (const bad of [0, -1, 1e9, Number.NaN]) {
  const made = m.createElement('video', { aspect: bad }, { x: 0, y: 0 })
  if (!(made.aspect > 0.05 && made.aspect < 10)) {
    fail(\`an aspect of \${bad} was kept: \${made.aspect}\`)
  }
}

/* --- every kind has a style and tags -------------------------------- */
//
// These were on the note, so a video, a deck, a PDF and a table had neither -
// which meant they could not be coloured, labelled, or found by a filter, and
// the settings panel could only offer a colour picker to one kind.
for (const kind of ['note', 'video', 'flash', 'pdf', 'table', 'link']) {
  const made = m.createElement(kind, {}, { x: 0, y: 0 })
  if (!made.style || typeof made.style.backgroundColor !== 'string') {
    fail(\`a \${kind} has no style, so it cannot be coloured\`)
  }
  if (!Array.isArray(made.tags)) {
    fail(\`a \${kind} has no tags, so it cannot be labelled or filtered\`)
  }
}
// A video's frame is black, because a white frame around a black player reads as
// a rendering fault.
if (m.createElement('video', {}, { x: 0, y: 0 }).style.backgroundColor === '#ffffff') {
  fail('a new video was created with a white background')
}
// Tags survive on any kind, which is the point of them being on the base.
const taggedVideo = m.normalizeElement({ kind: 'video', tags: ['lecture', 'week 1'] })
if (taggedVideo.tags.join(',') !== 'lecture,week 1') {
  fail(\`a video lost its tags: \${JSON.stringify(taggedVideo.tags)}\`)
}
// A stored aspect of zero would collapse every resize, so it is refused — and
// the *size* is left exactly as it was, because the aspect governs future
// resizes, not what is on screen now. Reshaping an element on load would move
// every video in every document the moment it was opened.
const zeroAspect = m.normalizeElement({ kind: 'video', aspect: 0, width: 400, height: 300 })
if (!(zeroAspect.aspect > 0.01)) fail(\`an aspect of 0 was kept: \${zeroAspect.aspect}\`)
if (zeroAspect.width !== 400 || zeroAspect.height !== 300) {
  fail(\`an element was reshaped on load: \${zeroAspect.width}x\${zeroAspect.height}\`)
}

/* --- a flash deck ---------------------------------------------------- */
const emptyDeck = m.normalizeElement({ kind: 'flash', cards: [] })
if (emptyDeck.cards.length !== 1) fail(\`an empty deck became \${emptyDeck.cards.length} cards\`)
if (emptyDeck.cards[0].length !== 2) fail('an empty deck did not get two sides')
// A card with one side cannot be turned over, and one with three has nowhere to
// put the third. Both are dropped, which leaves an empty deck — and an empty
// deck gets a fresh blank card, so the element is still something you can use
// rather than a frame with nothing in it.
const odd = m.normalizeElement({
  kind: 'flash',
  cards: [[{ text: 'a' }], [{ text: 'a' }, { text: 'b' }, { text: 'c' }]],
})
if (odd.cards.length !== 1) fail(\`a deck of only bad pairs became \${odd.cards.length}\`)
if (odd.cards[0].length !== 2) fail(\`the fallback card has \${odd.cards[0].length} sides\`)
if (odd.cards[0][0].text !== '' || odd.cards[0][1].text !== '') {
  fail('a bad pair leaked text into the fallback card')
}

/* --- a table --------------------------------------------------------- */
const table = m.createElement('table', {}, { x: 0, y: 0 })
if (table.columns.length < 2) fail(\`a new table has \${table.columns.length} columns\`)
if (table.cells.length !== table.columns.length * table.rowCount) {
  fail(\`a new table has \${table.cells.length} cells for \${table.columns.length} columns x \${table.rowCount} rows\`)
}
// A cell array that does not match the columns is either unreadable or has text
// in the wrong place. Both are fixed rather than rendered as a table with holes.
const mismatched = m.normalizeElement({
  kind: 'table',
  columns: [{ id: 'a', title: 'A', width: 1 }, { id: 'b', title: 'B', width: 1 }],
  cells: ['1', '2', '3', '4', '5', '6', '7', '8'],
})
if (mismatched.cells.length !== mismatched.columns.length * mismatched.rowCount) {
  fail(\`a mismatched table kept \${mismatched.cells.length} cells\`)
}
if (mismatched.rowCount !== 4) fail(\`rowCount came out as \${mismatched.rowCount}, expected 4\`)
if (mismatched.cells[7] !== '8') fail(\`the last cell is "\${mismatched.cells[7]}"\`)
if (mismatched.cells.length !== 8) fail(\`a cell was dropped: \${mismatched.cells.length}\`)
// A table with no columns is rebuilt, because the cell array is indexed against
// the column count.
const noColumns = m.normalizeElement({ kind: 'table', columns: [], cells: ['a'] })
if (noColumns.columns.length === 0) fail('a table with no columns was left that way')
if (noColumns.cells.length !== noColumns.columns.length * noColumns.rowCount) {
  fail('a rebuilt table does not line up')
}

/* --- an unknown kind becomes a note, not a gap ----------------------- */
// A file written by a later version, opened by an earlier one, is a real thing
// that will happen. A note with the text still in it is recoverable; a gap is a
// page that came apart.
const future = m.normalizeElement({ kind: 'hologram', title: 'A thing', body: 'text' })
if (future.kind !== 'note') fail(\`an unknown kind became "\${future.kind}"\`)
if (future.body !== 'text') fail('an unknown kind lost its text')

/* --- numbers that move a camera ------------------------------------- */
const badStep = m.normalizeDoc({
  pages: [],
  settings: {
    steps: [
      { id: 'a', targetKind: 'element', targetId: 'x', zoom: Number.NaN, durationMs: -5 },
      { id: 'b', targetKind: 'element', targetId: 'x', zoom: 900 },
      { id: 'c', targetKind: 'element', targetId: 'x', durationMs: 9e9 },
      { id: 'd', targetKind: 'page', targetId: 'element_x' },
      { id: 'e', targetKind: 'element', trigger: 'timed', autoAdvanceMs: 50 },
      { id: 'f', targetKind: 'element', transition: 'instant', durationMs: 900 },
      { id: 'a', targetKind: 'element' },
      null,
      'not a step',
    ],
  },
})
const steps = badStep.settings.steps
// Nine entries in: six with distinct ids, one duplicate of 'a', and two that are
// not steps at all. The duplicate and the two rubbish ones go; the six survive.
if (steps.length !== 6) fail(\`nine bad steps became \${steps.length}\`)
for (const [i, step] of steps.entries()) {
  if (!Number.isFinite(step.zoom)) fail(\`step \${i} kept a non-finite zoom: \${step.zoom}\`)
  if (step.zoom <= 0 || step.zoom > 2.001) fail(\`step \${i} kept zoom \${step.zoom}\`)
  if (step.durationMs < 0 || step.durationMs > 4000) fail(\`step \${i} kept duration \${step.durationMs}\`)
}
// A duplicate id makes React keys collide and "remove this step" remove the
// wrong one, so the second copy is dropped rather than renamed.
if (new Set(steps.map((s) => s.id)).size !== steps.length) fail('a duplicate step id survived')
if (steps[3].targetId !== null) fail('a page step kept a target id')
if (steps[4].autoAdvanceMs < 1000) fail(\`a 50ms countdown was allowed: \${steps[4].autoAdvanceMs}\`)
if (steps[5].durationMs !== 0) fail(\`an instant step kept a duration: \${steps[5].durationMs}\`)
for (const step of steps) {
  if (step.trigger !== 'timed' && step.autoAdvanceMs !== 0) {
    fail(\`a \${step.trigger} step kept a countdown: \${step.autoAdvanceMs}\`)
  }
}

/* --- a viewport ------------------------------------------------------ */
const zoomed = m.normalizeDoc({ pages: [{ viewport: { x: 1, y: 2, zoom: 9000 } }] })
if (zoomed.pages[0].viewport.zoom > 4.001) {
  fail(\`a zoom of 9000 was kept: \${zoomed.pages[0].viewport.zoom}\`)
}

/* --- groups and connections that point at nothing --------------------- */
const dangling = m.normalizeDoc({
  pages: [{
    elements: [{ id: 'real', kind: 'note', title: 'Here' }],
    groups: [{ id: 'g1', title: 'G', memberIds: ['real', 'ghost'] }],
    connections: [
      { id: 'l1', source: { kind: 'element', id: 'real' }, target: { kind: 'element', id: 'real' } },
      { id: 'l2', source: { kind: 'element', id: 'real' }, target: { kind: 'element', id: 'ghost' } },
      { id: 'l3', source: { kind: 'group', id: 'g1' }, target: { kind: 'element', id: 'real' } },
      { id: 'l4', source: null, target: { kind: 'element', id: 'real' } },
    ],
  }],
})
const page = dangling.pages[0]
if (page.groups[0].memberIds.length !== 1) {
  fail(\`a group kept a member that is not on the page: \${page.groups[0].memberIds}\`)
}
if (page.groups[0].memberIds[0] !== 'real') fail('the wrong member survived')
if (page.connections.length !== 2) fail(\`connections came out as \${page.connections.length}\`)
if (page.connections.some((c) => c.source.id === 'ghost' || c.target.id === 'ghost')) {
  fail('a connection to a missing element survived')
}
if (page.connections.some((c) => c.id === 'l4')) fail('a connection with one end survived')
// A connection to a group *does* work, because the group is on the page.
if (!page.connections.some((c) => c.id === 'l3')) fail('a connection to a real group was dropped')

/* --- a stored file with a bad path ------------------------------------ */
// A path is used to build a URL, so a leading slash or a '..' escapes the
// document's own folder. Refused, not normalised: a file whose path is wrong is
// a file to re-upload, not one to guess at.
for (const path of ['/etc/passwd', '../other-doc/a.pdf', 'a/../../b.pdf']) {
  const element = m.normalizeElement({ kind: 'pdf', file: { path, name: 'x.pdf', size: 10 } })
  if (element.file !== null) fail(\`a file at "\${path}" was accepted: \${element.file.path}\`)
}
const goodFile = m.normalizeElement({
  kind: 'pdf',
  file: { path: 'doc-1/abc.pdf', name: 'lecture.pdf', size: 100, mime: 'application/pdf' },
})
if (!goodFile.file) fail('a valid file was refused')
if (goodFile.file.size < 0) fail('a negative file size was kept')

/* --- round trip ------------------------------------------------------- */
const original = m.createElement('note', { title: 'A note', body: '# Hi' }, { x: 10, y: 20 })
const round = m.normalizeDoc({ pages: [{ id: 'p', elements: [original] }] })
const back = round.pages[0].elements[0]
if (back.title !== 'A note' || back.body !== '# Hi') fail('a note did not round trip')
if (back.x !== 10 || back.y !== 20) fail('geometry did not round trip')
if (JSON.parse(m.serializeDoc(round)).version !== 2) fail('serializing lost the version')

process.stdout.write(JSON.stringify(failures))
`

let failures = []
try {
  const scriptFile = path.join(dir, 'checks.mjs')
  fs.writeFileSync(scriptFile, script)
  const output = execFileSync(process.execPath, [scriptFile, bundle, defaultsBundle], {
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
    'elements: every kind survives hostile JSON, bad numbers are bounded, groups and connections that point at nothing are dropped',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
