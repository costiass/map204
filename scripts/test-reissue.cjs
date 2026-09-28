// Proves that `reissueIds` changes only what it says it changes.
//
// This exists because the failure mode is silent. A missed reference does not
// throw: `normalizeDoc` drops references to ids it has not seen, so a bad
// rewrite would quietly flatten a card out of its group or orphan a connection.
// The user would find their map had come apart with nothing in any log.
//
// So the assertions are about *shape*, not "it ran without error":
//   - every connection still joins two things that exist
//   - every group membership and parent relationship survives
//   - no id is reused from the original
//   - nothing but ids moved
//
// The real TypeScript is bundled and imported, not re-implemented here — a copy
// of the logic would test the copy and prove nothing about the code that runs.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

/**
 * Bundle the real TypeScript so it can be imported.
 *
 * Invoked as `node node_modules/rolldown/bin/cli.mjs` rather than through the
 * `.cmd` shim in `node_modules/.bin`, which `spawnSync` refuses on Windows with
 * EINVAL. The shim is a batch file, and Node cannot exec one directly.
 */
const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reissue-'))
const bundlePath = path.join(dir, 'reissue.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/utils/reissue.ts', '--format', 'esm', '--file', bundlePath],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle src/utils/reissue.ts: ${error.stderr ?? error.message}`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/* A document exercising every reference kind at once                  */
/* ------------------------------------------------------------------ */

const original = {
  version: 1,
  settings: { defaultCardStyle: { accentColor: '#6366F1' }, defaultRelationshipType: '' },
  pages: [
    {
      id: 'page_original',
      title: 'A page',
      position: { x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 },
      viewport: { x: 5, y: 6, zoom: 0.5 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      cards: [
        {
          id: 'card_parent',
          title: 'Parent',
          content: 'hello',
          image: { src: null, alt: '' },
          position: { x: 10, y: 20, width: 280, height: 120, zIndex: 1 },
          style: {},
          tags: ['keep'],
          collapsed: false,
          parentId: null,
          checklist: [{ id: 'c1', text: 'do it', done: false }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'card_child',
          title: 'Child',
          content: '',
          image: { src: null, alt: '' },
          position: { x: 30, y: 40, width: 200, height: 100, zIndex: 2 },
          style: {},
          tags: [],
          collapsed: true,
          parentId: 'card_parent',
          checklist: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      groups: [
        {
          id: 'group_one',
          title: 'A group',
          position: { x: 0, y: 0, width: 400, height: 300, zIndex: 1 },
          color: '#0EA5E9',
          memberCardIds: ['card_parent', 'card_child'],
          memberGroupIds: ['group_two'],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'group_two',
          title: 'Nested group',
          position: { x: 10, y: 10, width: 200, height: 150, zIndex: 2 },
          color: '#16A34A',
          memberCardIds: [],
          memberGroupIds: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      connections: [
        {
          id: 'connection_a',
          source: { kind: 'card', id: 'card_parent' },
          target: { kind: 'card', id: 'card_child' },
          sourceAnchor: 'right',
          targetAnchor: 'left',
          label: 'leads to',
          relationshipType: 'leads to',
          style: { color: '#fff', width: 2, lineStyle: 'solid', routing: 'curved', arrowStart: 'none', arrowEnd: 'arrow', animated: false },
        },
        {
          id: 'connection_b',
          source: { kind: 'card', id: 'card_child' },
          target: { kind: 'group', id: 'group_one' },
          sourceAnchor: null,
          targetAnchor: null,
          label: '',
          relationshipType: 'part of',
          style: { color: '#fff', width: 2, lineStyle: 'dashed', routing: 'curved', arrowStart: 'none', arrowEnd: 'triangle', animated: false },
        },
        {
          id: 'connection_c',
          source: { kind: 'group', id: 'group_one' },
          target: { kind: 'group', id: 'group_two' },
          sourceAnchor: 'bottom',
          targetAnchor: 'top',
          label: '',
          relationshipType: 'related to',
          style: { color: '#fff', width: 2, lineStyle: 'solid', routing: 'stepped', arrowStart: 'none', arrowEnd: 'arrow', animated: false },
        },
      ],
    },
  ],
}

/* ------------------------------------------------------------------ */
/* Assertions, run inside the module so `reissueIds` is in scope         */
/* ------------------------------------------------------------------ */

const url = `data:text/javascript;base64,${Buffer.from(fs.readFileSync(bundlePath)).toString('base64')}`

const checks = `
const failures = []
const fail = (m) => failures.push(m)

const { doc: after, ids } = reissueIds(original)
const page = after.pages[0]
const beforePage = original.pages[0]

// --- every id is new ---
const oldIds = new Set()
for (const p of original.pages) {
  oldIds.add(p.id)
  for (const c of p.cards) oldIds.add(c.id)
  for (const g of p.groups) oldIds.add(g.id)
  for (const c of p.connections) oldIds.add(c.id)
}
const newIds = new Set()
for (const p of after.pages) {
  newIds.add(p.id)
  for (const c of p.cards) newIds.add(c.id)
  for (const g of p.groups) newIds.add(g.id)
  for (const c of p.connections) newIds.add(c.id)
}
for (const id of newIds) {
  if (oldIds.has(id)) fail(\`id "\${id}" was copied from the original instead of re-issued\`)
}
if (newIds.size !== oldIds.size) {
  fail(\`expected \${oldIds.size} ids, found \${newIds.size}\`)
}

// --- references still resolve ---
const cardIds = new Set(page.cards.map((c) => c.id))
const groupIds = new Set(page.groups.map((g) => g.id))
const resolves = (e) => (e.kind === 'card' ? cardIds : groupIds).has(e.id)

for (const c of page.connections) {
  if (!resolves(c.source)) fail(\`connection \${c.id} has a dangling source\`)
  if (!resolves(c.target)) fail(\`connection \${c.id} has a dangling target\`)
}
for (const g of page.groups) {
  for (const m of g.memberCardIds) {
    if (!cardIds.has(m)) fail(\`group "\${g.title}" lost card membership "\${m}"\`)
  }
  for (const m of g.memberGroupIds) {
    if (!groupIds.has(m)) fail(\`group "\${g.title}" lost group membership "\${m}"\`)
  }
}
if (page.cards.length !== 2) fail(\`expected 2 cards, found \${page.cards.length}\`)
if (page.groups.length !== 2) fail(\`expected 2 groups, found \${page.groups.length}\`)
if (page.connections.length !== 3) fail(\`expected 3 connections, found \${page.connections.length}\`)

// --- group membership: not just "every reference resolves", but "every
// reference survived". A dropped member still passes the resolution check,
// because the ids left behind all exist — so the counts are asserted too.
for (const g of page.groups) {
  const old = beforePage.groups.find((o) => o.title === g.title)
  if (!old) continue
  if (g.memberCardIds.length !== old.memberCardIds.length) {
    fail(\`group "\${g.title}" holds \${g.memberCardIds.length} cards, originally \${old.memberCardIds.length}\`)
  }
  if (g.memberGroupIds.length !== old.memberGroupIds.length) {
    fail(\`group "\${g.title}" nests \${g.memberGroupIds.length} groups, originally \${old.memberGroupIds.length}\`)
  }
  // And the members must be the same cards, not merely the same number.
  const expected = new Set(old.memberCardIds.map((id) => ids.cards.get(id)))
  for (const member of g.memberCardIds) {
    if (!expected.has(member)) {
      fail(\`group "\${g.title}" holds a card that was not in it before\`)
    }
  }
}

// --- the parent relationship, the easiest thing to lose ---
const child = page.cards.find((c) => c.title === 'Child')
if (!child.parentId) {
  fail('the parent relationship was lost')
} else if (!cardIds.has(child.parentId)) {
  fail('the parent relationship points at an id that does not exist')
} else if (ids.cards.get('card_parent') !== child.parentId) {
  fail('the parent points at the wrong card')
}

// --- nothing but ids moved ---
if (JSON.stringify(page.position) !== JSON.stringify(beforePage.position)) fail('page position changed')
if (JSON.stringify(page.viewport) !== JSON.stringify(beforePage.viewport)) fail('page viewport changed')
if (page.title !== beforePage.title) fail('page title changed')
if (JSON.stringify(after.settings) !== JSON.stringify(original.settings)) fail('settings changed')

const oldByTitle = new Map(beforePage.cards.map((c) => [c.title, c]))
for (const card of page.cards) {
  const old = oldByTitle.get(card.title)
  if (!old) { fail(\`unexpected card "\${card.title}"\`); continue }
  const strip = ({ id, parentId, ...rest }) => rest
  if (JSON.stringify(strip(card)) !== JSON.stringify(strip(old))) {
    fail(\`card "\${card.title}" changed in more than its id\`)
  }
}
const oldGroups = new Map(beforePage.groups.map((g) => [g.title, g]))
for (const group of page.groups) {
  const old = oldGroups.get(group.title)
  if (!old) { fail(\`unexpected group "\${group.title}"\`); continue }
  if (group.color !== old.color) fail(\`group "\${group.title}" changed colour\`)
  if (JSON.stringify(group.position) !== JSON.stringify(old.position)) fail(\`group "\${group.title}" moved\`)
}
// The map runs old id -> new id, so to find an old connection from a new one,
// walk it backwards rather than forwards.
const oldIdFor = new Map([...ids.connections].map(([oldId, newId]) => [newId, oldId]))
for (const c of page.connections) {
  const oldId = oldIdFor.get(c.id)
  const old = beforePage.connections.find((o) => o.id === oldId)
  if (!old) { fail(\`connection \${c.id} has no counterpart\`); continue }
  if (c.relationshipType !== old.relationshipType) fail(\`connection \${c.id} changed relationship\`)
  if (c.style.lineStyle !== old.style.lineStyle) fail(\`connection \${c.id} changed stroke\`)
  if (c.label !== old.label) fail(\`connection \${c.id} changed label\`)
}

// --- the input is not mutated ---
if (original.pages[0].id !== 'page_original') fail('the input document was mutated')
if (original.pages[0].cards[1].parentId !== 'card_parent') fail('the input parent link was mutated')
if (beforePage.groups[0].memberCardIds.length !== 2) fail('the input group membership was mutated')

// --- importing twice yields two independent documents ---
const again = reissueIds(original).doc
const shared = after.pages[0].cards.filter((c) => again.pages[0].cards.some((x) => x.id === c.id))
if (shared.length > 0) fail(\`two imports of one file share \${shared.length} card id(s)\`)

process.stdout.write(JSON.stringify(failures))
`

try {
  const output = execFileSync(
    process.execPath,
    [
      '-e',
      `const original = ${JSON.stringify(original)};
       import(${JSON.stringify(url)})
         .then((m) => {
           const reissueIds = m.reissueIds
           const checks = ${JSON.stringify(checks)}
           // eslint-disable-next-line no-new-func
           new Function('reissueIds', 'original', checks)(reissueIds, original)
         })
         .catch((e) => { console.error(String(e)); process.exit(3) })`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const failures = JSON.parse(output)
  for (const message of failures) console.log(`FAIL  ${message}`)

  fs.rmSync(dir, { recursive: true, force: true })

  if (failures.length === 0) {
    console.log(
      'reissue: every reference survives, nothing but ids changed, two imports stay independent',
    )
  } else {
    console.log(`\n${failures.length} check(s) failed.`)
    process.exit(1)
  }
} catch (error) {
  fs.rmSync(dir, { recursive: true, force: true })
  console.log(`FAIL  the checks could not run: ${error.stderr ?? error.message}`)
  process.exit(1)
}
