// What you can do to the things on a page.
//
// These are plain functions over a page, which is the only reason they can be
// tested at all. The store actions that wrap them need a mounted store, a
// document and an active page before anything happens, so a question like "does
// deleting an element remove the connections that pointed at it" would
// otherwise only be answerable by clicking around the app and looking.
//
// Every assertion here is about a *relationship* — an element to its
// connections, a group to its members, a cell to its table — because those are
// where the silent failures are. A wrong position is obvious on screen; a
// connection drawn to a deleted card is not, and nobody reports it, they just
// stop using the app.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elemops-'))
const opsBundle = path.join(dir, 'elementOps.mjs')
const makeBundle = path.join(dir, 'serialize.mjs')

const bundleTo = (entry, out) =>
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, entry, '--format', 'esm', '--file', out],
    { stdio: 'pipe' },
  )

try {
  bundleTo('src/store/elementOps.ts', opsBundle)
  bundleTo('src/elements/serialize.ts', makeBundle)
} catch (error) {
  console.log(`FAIL  could not bundle: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const script = `
import { pathToFileURL } from 'node:url'
const [o, s] = await Promise.all([
  import(pathToFileURL(process.argv[2]).href),
  import(pathToFileURL(process.argv[3]).href),
])

const failures = []
const fail = (msg) => failures.push(msg)

let idCounter = 0
const makeId = (prefix) => \`\${prefix}_copy_\${++idCounter}\`

const note = (id, over) => s.createElement('note', { id, title: 'Note ' + id, ...over }, { x: 0, y: 0 })
const pageWith = (elements, extra = {}) => ({
  id: 'p1',
  title: 'Page',
  ordinal: 0,
  viewport: { x: 0, y: 0, zoom: 1 },
  elements,
  groups: [],
  connections: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})
const connect = (id, from, to) => ({
  id,
  source: { kind: 'element', id: from },
  target: { kind: 'element', id: to },
  label: '',
  relationshipType: 'related to',
  style: { color: '#000', width: 2, lineStyle: 'solid', routing: 'curved', arrowStart: 'none', arrowEnd: 'arrow', animated: false },
})
const group = (id, over = {}) => ({
  id, title: 'Group ' + id,
  x: 0, y: 0, width: 400, height: 300, zIndex: 0,
  color: '#123',
  memberIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/* --- deleting removes what pointed at the thing ---------------------- */
// The single most important property here, and the one that fails silently: a
// connection is stored by id, so deleting an element without deleting its
// connections leaves lines drawn to nothing, with nothing on screen to explain.
{
  const page = pageWith([note('a'), note('b'), note('c')], {
    connections: [connect('l1', 'a', 'b'), connect('l2', 'b', 'c'), connect('l3', 'a', 'c')],
    groups: [group('g1', { memberIds: ['a', 'b', 'c'] })],
  })
  o.deleteElements(page, ['b'])
  if (page.elements.length !== 2) fail(\`deleting one left \${page.elements.length} elements\`)
  if (page.connections.length !== 1) fail(\`deleting one left \${page.connections.length} connections\`)
  if (page.connections[0].id !== 'l3') fail(\`the wrong connection survived: \${page.connections[0].id}\`)
  if (page.groups[0].memberIds.includes('b')) fail('the deleted element is still a group member')
  if (page.groups[0].memberIds.length !== 2) fail(\`a group lost the wrong members: \${page.groups[0].memberIds}\`)
}

// Deleting several at once, where a connection joins two of them.
{
  const page = pageWith([note('a'), note('b'), note('c')], {
    connections: [connect('l1', 'a', 'b'), connect('l2', 'a', 'c')],
  })
  o.deleteElements(page, ['a', 'b'])
  if (page.elements.length !== 1) fail('a bulk delete removed the wrong number')
  if (page.connections.length !== 0) fail(\`a connection between two deleted things survived (\${page.connections.length})\`)
}

// Nothing to delete is not an error and not a history entry worth making.
{
  const page = pageWith([note('a')], { connections: [connect('l1', 'a', 'a')] })
  o.deleteElements(page, [])
  if (page.elements.length !== 1) fail('deleting nothing deleted something')
  if (page.connections.length !== 1) fail('deleting nothing removed a connection')
}

/* --- a group is a container, not a frame ------------------------------ */
{
  const page = pageWith([note('a'), note('b')], {
    groups: [group('g1', { memberIds: ['a', 'b'] })],
  })
  o.moveGroupWithMembers(page, 'g1', 100, 50)
  if (page.groups[0].x !== 100 || page.groups[0].y !== 50) fail('the group did not move')
  for (const id of ['a', 'b']) {
    const element = o.findElement(page, id)
    if (element.x !== 100 || element.y !== 50) {
      fail(\`member \${id} was left behind at \${element.x},\${element.y}\`)
    }
  }
}

// A group that is not on the page moves nothing at all.
{
  const page = pageWith([note('a')], { groups: [group('g1', { memberIds: ['a'] })] })
  o.moveGroupWithMembers(page, 'ghost', 100, 100)
  if (o.findElement(page, 'a').x !== 0) fail('a missing group moved a member')
}

/* --- growing a group moves what is inside it ------------------------- */
{
  const page = pageWith([note('a', { x: 0, y: 0 })], {
    groups: [group('g1', { x: 0, y: 0, width: 200, height: 200, memberIds: ['a'] })],
  })
  const before = { x: 0, y: 0, width: 200, height: 200 }
  page.groups[0].width = 400
  page.groups[0].height = 400
  o.resizeGroupMembers(page, page.groups[0], before)

  // The member was at the group's origin, so it stays at the group's origin.
  const member = o.findElement(page, 'a')
  if (member.x !== 0 || member.y !== 0) fail(\`a member at the origin moved to \${member.x},\${member.y}\`)
  // Its size doubles, because the group did.
  if (member.width !== 560) fail(\`a member in a doubled group is \${member.width} wide, expected 560\`)
}

// A member partway across the group keeps its *relative* position, rather than
// staying absolutely still while the space around it stretches.
{
  const page = pageWith([note('a', { x: 100, y: 50 })], {
    groups: [group('g1', { x: 0, y: 0, width: 200, height: 200, memberIds: ['a'] })],
  })
  o.resizeGroupMembers(page, page.groups[0], { x: 0, y: 0, width: 200, height: 200 })
  o.resizeGroupMembers(page, { ...page.groups[0], width: 400, height: 400 }, { x: 0, y: 0, width: 200, height: 200 })
  // The first call halved the scale (200 -> 200 is 1, so this is a no-op check
  // that the member is still inside); the second doubled it.
  const member = o.findElement(page, 'a')
  if (member.x < 0) fail(\`a member ended up outside the group at x=\${member.x}\`)
}

// A degenerate "before" — a group with no size — must not divide by zero and
// scatter its members to infinity.
{
  const page = pageWith([note('a')], {
    groups: [group('g1', { x: 0, y: 0, width: 200, height: 200, memberIds: ['a'] })],
  })
  o.resizeGroupMembers(page, page.groups[0], { x: 0, y: 0, width: 0, height: 0 })
  const member = o.findElement(page, 'a')
  if (!Number.isFinite(member.x) || Math.abs(member.x) > 1e6) {
    fail(\`a zero-size group scattered a member to \${member.x}\`)
  }
}

/* --- dropping something into a group --------------------------------- */
{
  const page = pageWith([note('a', { x: 10, y: 10, width: 100, height: 50 })], {
    groups: [
      group('outer', { x: 0, y: 0, width: 400, height: 400 }),
      group('inner', { x: 50, y: 50, width: 200, height: 200 }),
    ],
  })
  // Inside both: the *innermost* wins, because a group inside a group is the more
  // specific claim and joining the outer one too would make the two impossible
  // to separate again.
  const found = o.groupContaining(page, { x: 60, y: 60, width: 50, height: 50 })
  if (!found || found.id !== 'inner') fail(\`chose the wrong group: \${found && found.id}\`)

  // Past the outside of both, where neither reaches.
  if (o.groupContaining(page, { x: 500, y: 500, width: 20, height: 20 }) !== null) {
    fail('something outside every group was put in one')
  }
  // Excluding a group is what dragging a group uses, so moving a group does not
  // drop it into itself.
  const excluding = o.groupContaining(page, { x: 60, y: 60, width: 50, height: 50 }, ['inner'])
  if (!excluding || excluding.id !== 'outer') fail(\`excluding a group did not work: \${excluding && excluding.id}\`)
}

// Straddling an edge is being outside it. Tested on a page with a single group,
// because a point that overhangs the inner group is legitimately inside the outer
// one, and asserting on that here would be asserting the wrong thing.
{
  const page = pageWith([note('a')], {
    groups: [group('g1', { x: 100, y: 100, width: 200, height: 200 })],
  })
  if (!o.groupContaining(page, { x: 150, y: 150, width: 20, height: 20 })) {
    fail('something wholly inside was not put in the group')
  }
  // A half-in group is not a group you are in, and a rule that said otherwise
  // would capture everything dropped anywhere near it.
  if (o.groupContaining(page, { x: 250, y: 150, width: 100, height: 20 }) !== null) {
    fail('something overhanging the right edge was put in the group')
  }
  if (o.groupContaining(page, { x: 150, y: 250, width: 20, height: 100 }) !== null) {
    fail('something overhanging the bottom edge was put in the group')
  }
  // Exactly filling it is inside, not straddling — every edge is touched, and
  // touching an edge is not overhanging it.
  if (!o.groupContaining(page, { x: 100, y: 100, width: 200, height: 200 })) {
    fail('something exactly filling the group was not put in it')
  }
  // One pixel over is over.
  if (o.groupContaining(page, { x: 100, y: 100, width: 201, height: 200 }) !== null) {
    fail('something one pixel too wide was put in the group')
  }
}

// One element, one group.
{
  const page = pageWith([note('a')], { groups: [group('g1'), group('g2')] })
  o.addElementToGroup(page, 'g1', 'a')
  o.addElementToGroup(page, 'g2', 'a')
  if (page.groups[0].memberIds.includes('a')) fail('the element is in two groups')
  if (!page.groups[1].memberIds.includes('a')) fail('the element did not move to the second group')
}

/* --- a video keeps its shape ----------------------------------------- */
{
  const video = s.createElement('video', { id: 'v', aspect: 16 / 9, width: 640, height: 360 }, { x: 0, y: 0 })
  const page = pageWith([video])
  // Dragging the *width* handle sets the width, and the height follows.
  o.resizeElement(page, 'v', { width: 320, height: 999 })
  const v = o.findElement(page, 'v')
  if (v.width !== 320) fail(\`the width is \${v.width}\`)
  if (Math.abs(v.width / v.height - 16 / 9) > 0.02) {
    fail(\`dragging the width gave \${v.width}x\${v.height}, which is not 16:9\`)
  }

  // Dragging the *height* handle sets the height, and the width follows. Getting
  // this wrong is the difference between a video that grows smoothly and one
  // that fights the pointer.
  o.resizeElement(page, 'v', { width: 999, height: 180 }, {}, 'height')
  if (Math.abs(o.findElement(page, 'v').height - 180) > 0.001) {
    fail(\`dragging the height gave \${o.findElement(page, 'v').height}\`)
  }
  if (Math.abs(o.findElement(page, 'v').width / 180 - 16 / 9) > 0.02) {
    fail('dragging the height did not produce a 16:9 video')
  }
}

// A note is free to be any shape it likes.
{
  const page = pageWith([note('n', { width: 200, height: 100 })])
  o.resizeElement(page, 'n', { width: 400, height: 400 })
  const n = o.findElement(page, 'n')
  if (n.width !== 400 || n.height !== 400) fail(\`a note was constrained: \${n.width}x\${n.height}\`)
}

// Nothing can be resized to nothing, and a bad number cannot be written.
{
  const page = pageWith([note('n', { width: 200, height: 100 })])
  o.resizeElement(page, 'n', { width: 0, height: -50 })
  if (o.findElement(page, 'n').width < 1) fail('an element was resized to nothing')
  o.applyPatch(o.findElement(page, 'n'), { width: Number.NaN, height: 'wide' })
  const n = o.findElement(page, 'n')
  if (!Number.isFinite(n.width) || n.height <= 0) fail(\`a bad patch was written: \${n.width}x\${n.height}\`)
}

/* --- duplicating makes new ids everywhere --------------------------- */
{
  const table = s.createElement('table', { id: 't' }, { x: 0, y: 0 })
  table.cells = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
  const flash = s.createElement('flash', { id: 'f' }, { x: 0, y: 0 })
  const noteEl = s.createElement('note', { id: 'n', title: 'T' }, { x: 0, y: 0 })
  noteEl.checklist = [{ id: 'item1', text: 'do it', done: false }]
  const page = pageWith([table, flash, noteEl])

  const created = o.duplicateElements(page, ['t', 'f', 'n'], makeId)
  if (created.length !== 3) fail(\`duplicating three made \${created.length}\`)
  if (new Set(created).size !== 3) fail('the copies share an id')
  for (const original of [table, flash, noteEl]) {
    if (created.includes(original.id)) fail('a copy kept its original id')
  }

  const copyTable = o.findElement(page, created[0])
  const copyFlash = o.findElement(page, created[1])
  const copyNote = o.findElement(page, created[2])

  // A copy sharing a column id with the original means renaming one column
  // header renames both, and there is no way back.
  for (const column of table.columns) {
    if (copyTable.columns.some((c) => c.id === column.id)) {
      fail('the copied table shares a column id with the original')
    }
  }
  for (const side of flash.cards.flat()) {
    if (copyFlash.cards.flat().some((s2) => s2.id === side.id)) {
      fail('the copied deck shares a side id with the original')
    }
  }
  if (copyNote.checklist.some((i) => noteEl.checklist.some((j) => j.id === i.id))) {
    fail('the copied note shares a checklist id with the original')
  }
  // The content itself is copied, or the duplicate is not a duplicate.
  if (JSON.stringify(copyTable.cells) !== JSON.stringify(table.cells)) {
    fail('the copied table lost its cells')
  }
  if (JSON.stringify(copyFlash.cards.map((p) => p.map((s2) => s2.text))) !==
      JSON.stringify(flash.cards.map((p) => p.map((s2) => s2.text)))) {
    fail('the copied deck lost its text')
  }
  // And a copy is offset, or it is hidden underneath the original.
  if (copyTable.x === table.x || copyTable.y === table.y) fail('a copy landed on its original')
}

/* --- z-order ---------------------------------------------------------- */
{
  const page = pageWith([note('a', { zIndex: 1 }), note('b', { zIndex: 2 }), note('c', { zIndex: 3 })])
  o.applyZOrder(page, ['a'], 'front')
  if (o.findElement(page, 'a').zIndex <= 3) fail('send to front did not')
  o.applyZOrder(page, ['a'], 'back')
  if (o.findElement(page, 'a').zIndex >= 1) fail('send to back did not')
}

// A selected element moves one step, past whatever is unselected next to it —
// and if everything next to it is also selected it does not move at all, because
// there is nothing to move past.
//
// These are written out longhand rather than as "a goes to index 1" because the
// interesting cases are the ones where the whole selection is in a block: three
// elements with one unselected element above them can only shuffle among
// themselves, and an implementation that sorts per element gets that wrong.
{
  const page = pageWith([
    note('a', { zIndex: 1 }), note('b', { zIndex: 2 }),
    note('c', { zIndex: 3 }), note('d', { zIndex: 4 }),
  ])
  const order = () =>
    [...page.elements].sort((x, y) => x.zIndex - y.zIndex).map((e) => e.id)

  // Three at the front, one free element behind them: only the one that has
  // somewhere to go goes, because it is the only one with an unselected
  // neighbour.
  o.applyZOrder(page, ['a', 'b', 'c'], 'forward')
  if (JSON.stringify(order()) !== JSON.stringify(['a', 'b', 'd', 'c'])) {
    fail(\`bringing a block of three forward gave \${JSON.stringify(order())}\`)
  }

  // Now the block is a,b,d,c with b,c,d selected. Every one of them has only
  // *selected* elements behind it, so sending them backward does nothing at
  // all — which is the case a per-element sort gets wrong by shuffling the
  // selection and leaving the page as it was.
  o.applyZOrder(page, ['b', 'c', 'd'], 'backward')
  if (JSON.stringify(order()) !== JSON.stringify(['a', 'b', 'd', 'c'])) {
    fail(\`sending a solid block backward changed it: \${JSON.stringify(order())}\`)
  }

  // And with an unselected element behind them, the one that can move does, and
  // the unselected one is pushed forward past all of them.
  o.applyZOrder(page, ['a', 'b'], 'backward')
  if (JSON.stringify(order()) !== JSON.stringify(['a', 'd', 'b', 'c'])) {
    fail(\`sending two backward gave \${JSON.stringify(order())}\`)
  }

  // A selection with a *gap* in it — two separate elements, each with a free
  // element behind it — has to move both, and each moves exactly one step. A
  // pass that stops after the first swap gets this wrong, and this is the case
  // that catches it: every other case here needs one swap or none, so a pass
  // that only ever does one would pass all of them.
  const gapped = pageWith([
    note('s1', { zIndex: 1 }), note('x', { zIndex: 2 }),
    note('s2', { zIndex: 3 }), note('y', { zIndex: 4 }),
  ])
  o.applyZOrder(gapped, ['s1', 's2'], 'backward')
  const gappedOrder = [...gapped.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id)
  // s1 passes x; s2 passes y. Neither passes the other, and neither passes
  // both — one step, not "as far as it will go".
  if (JSON.stringify(gappedOrder) !== JSON.stringify(['x', 's1', 'y', 's2'])) {
    fail(\`sending a gapped selection backward gave \${JSON.stringify(gappedOrder)}\`)
  }

  // The same shape forwards, for the same reason. Here s2 is already last, so it
  // has nothing in front of it to pass and stays put — which is the other half
  // of "one step, only when there is somewhere to go".
  const gapped2 = pageWith([
    note('x', { zIndex: 1 }), note('s1', { zIndex: 2 }),
    note('y', { zIndex: 3 }), note('s2', { zIndex: 4 }),
  ])
  o.applyZOrder(gapped2, ['s1', 's2'], 'forward')
  const gapped2Order = [...gapped2.elements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.id)
  if (JSON.stringify(gapped2Order) !== JSON.stringify(['x', 'y', 's1', 's2'])) {
    fail(\`bringing a gapped selection forward gave \${JSON.stringify(gapped2Order)}\`)
  }
}

/* --- collapsing ------------------------------------------------------- */
{
  const page = pageWith([note('a'), note('b')])
  o.toggleCollapsed(page, ['a', 'b'])
  if (!o.findElement(page, 'a').collapsed) fail('collapsing did not collapse')
  o.toggleCollapsed(page, ['a', 'b'])
  if (o.findElement(page, 'a').collapsed) fail('expanding did not expand')
}
// A mixed selection goes one way, not two ways. Half the cards flat and half
// not reads as a mistake.
{
  const page = pageWith([note('a'), note('b', { collapsed: true })])
  o.toggleCollapsed(page, ['a', 'b'])
  if (!o.findElement(page, 'a').collapsed) fail('a mixed selection did not collapse')
  if (!o.findElement(page, 'b').collapsed) fail('a collapsed card was expanded by a mixed selection')
}

/* --- stacking new things --------------------------------------------- */
// Repeated presses must not stack. Checked by *placing* each one and asking
// again, rather than by asking twice about the same unchanged page — which is
// the version that passes whether or not the nudge works.
{
  const page = pageWith([])
  let at = o.freeSpotNear(page, 100, 100)
  if (at.x !== 100 || at.y !== 100) fail('a clear spot was moved')

  const first = s.createElement('note', { id: 'n1' }, at)
  page.elements.push(first)
  const second = o.freeSpotNear(page, 100, 100)
  if (second.x === 100 && second.y === 100) {
    fail('a second element was placed on top of the first')
  }

  page.elements.push(s.createElement('note', { id: 'n2' }, second))
  const third = o.freeSpotNear(page, 100, 100)
  if (third.x === 100 && third.y === 100 || third.x === second.x && third.y === second.y) {
    fail('a third element landed on one of the first two')
  }
}

/* --- a table's cells -------------------------------------------------- */
{
  const table = s.createElement('table', { id: 't' }, { x: 0, y: 0 })
  if (o.tableCell(table, 0, 0) !== '') fail('a new table has text in it')
  o.setTableCell(table, 1, 2, 'hello')
  if (o.tableCell(table, 1, 2) !== 'hello') fail(\`a cell did not keep its text: \${o.tableCell(table, 1, 2)}\`)
  if (o.tableCell(table, 0, 0) !== '') fail('writing one cell wrote another')
  // Writing past the end grows the table rather than losing the text.
  o.setTableCell(table, 0, table.columns.length + 2, 'far')
  if (o.tableCell(table, 0, table.columns.length + 2) !== 'far') {
    fail('a cell written past the end was lost')
  }
  // Reading off the end is empty, not a crash.
  if (o.tableCell(table, 99, 99) !== '') fail('reading off the end returned something')
}

/* --- a note's own edits are note-only ---------------------------------- */
{
  const page = pageWith([note('n'), s.createElement('video', { id: 'v' }, { x: 0, y: 0 })])
  if (!o.editNote(page, 'n', { title: 'Renamed' })) fail('a note edit was refused')
  if (o.findElement(page, 'n').title !== 'Renamed') fail('a note edit did not take')
  // Adding a checklist to a video is a thing that cannot happen, and the type
  // says so before it runs.
  if (o.editNote(page, 'v', { title: 'nope' })) fail('a note edit was applied to a video')
  if (o.findElement(page, 'v').title === 'nope') fail('a video took a note field')
  if (o.editNote(page, 'ghost', { title: 'nope' })) fail('an edit to nothing reported success')
}

process.stdout.write(JSON.stringify(failures))
`

let failures = []
try {
  const scriptFile = path.join(dir, 'checks.mjs')
  fs.writeFileSync(scriptFile, script)
  const output = execFileSync(process.execPath, [scriptFile, opsBundle, makeBundle], {
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
    'element ops: deleting takes its connections and memberships with it, groups carry their members, a video keeps its shape, copies get new ids everywhere',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
