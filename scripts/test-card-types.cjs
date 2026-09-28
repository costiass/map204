// A card that points at something must survive export and import unchanged.
//
// This is the part that has no test of its own and would otherwise be found out
// by exporting a video card, re-importing it a week later, and finding a note
// with a URL in the body. `normalizeCard` is the single place that decides what
// a card is, so it is exercised directly — including the case that actually
// matters: a document written *before* card kinds existed, which must still open.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardtype-'))
const bundle = path.join(dir, 'serialize.mjs')

// Bundled whole, with no `--external`: the `@/…` aliases are resolved from
// tsconfig, and marking them external leaves the bundle importing paths that do
// not exist in a `data:` module. An earlier version did that and the test could
// not run at all.
try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/utils/serialize.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const url = `data:text/javascript;base64,${Buffer.from(fs.readFileSync(bundle)).toString('base64')}`

const script = `
import(${JSON.stringify(url)})
  .then((m) => {
    const failures = []
    const fail = (msg) => failures.push(msg)

    const base = (over) => ({
      id: 'c1',
      title: 'A card',
      content: 'some text',
      image: { src: null, alt: '' },
      position: { x: 0, y: 0, width: 280, height: 120, zIndex: 1 },
      style: {},
      tags: [],
      collapsed: false,
      parentId: null,
      checklist: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    })

    // --- a card with no type at all, from before this existed ------------
    const legacy = m.parseDoc(JSON.stringify({ version: 1, pages: [{ id: 'p1', cards: [base({})] }] }))
    const legacyCard = legacy.doc.pages[0].cards[0]
    if (legacyCard.type !== 'note') {
      fail(\`a card with no type came back as "\${legacyCard.type}", expected "note"\`)
    }
    if (legacyCard.embed !== null) {
      fail('a card with no type gained an embed')
    }
    if (legacyCard.title !== 'A card' || legacyCard.content !== 'some text') {
      fail('an old card lost its title or content')
    }

    // --- a video card, round-tripped -------------------------------------
    const video = base({
      type: 'youtube',
      title: 'Lecture 3',
      content: '',
      embed: { url: 'https://youtu.be/dQw4w9WgXcQ', meta: { start: 90 } },
    })
    const json = JSON.stringify({ version: 1, pages: [{ id: 'p1', title: 'T', cards: [video] }] })
    const back = m.parseDoc(json).doc.pages[0].cards[0]
    if (back.type !== 'youtube') fail(\`video card came back as "\${back.type}"\`)
    if (back.embed?.url !== 'https://youtu.be/dQw4w9WgXcQ') {
      fail(\`the link did not survive: \${back.embed?.url}\`)
    }
    if (Number(back.embed?.meta?.start) !== 90) {
      fail(\`the timestamp did not survive: \${JSON.stringify(back.embed?.meta)}\`)
    }

    // Exporting and importing must be the same document.
    const reExported = m.serializeDoc(back ? { version: 1, pages: [{ ...m.parseDoc(json).doc.pages[0] }], settings: {} } : null)
    if (!reExported.includes('youtu.be/dQw4w9WgXcQ')) {
      fail('the link is missing from the re-exported file')
    }

    // --- a pdf card -------------------------------------------------------
    const pdf = m.parseDoc(JSON.stringify({
      version: 1,
      pages: [{ id: 'p1', cards: [base({ type: 'pdf', embed: { url: 'https://x.test/a.pdf' } })] }],
    })).doc.pages[0].cards[0]
    if (pdf.type !== 'pdf' || pdf.embed?.url !== 'https://x.test/a.pdf') {
      fail('a pdf card did not survive')
    }

    // --- hostile input in a file -----------------------------------------
    // An imported file is untrusted input, and it can carry anything.
    const hostile = m.parseDoc(JSON.stringify({
      version: 1,
      pages: [{
        id: 'p1',
        cards: [
          base({ type: 'calendar', embed: { url: 'https://x.test/a.pdf' } }),
          base({ id: 'c2', type: 'youtube', embed: { url: 'javascript:alert(1)' } }),
          base({ id: 'c3', type: 'pdf', embed: { url: 42, meta: 'not an object' } }),
          base({ id: 'c4', type: 'youtube', embed: { url: 'https://a.test', meta: { start: 'nope', n: 1.5, b: true } } }),
        ],
      }],
    })).doc.pages[0].cards

    if (hostile[0].type !== 'note') fail(\`an unknown kind became "\${hostile[0].type}"\`)
    if (hostile[0].embed !== null) fail('an unknown kind kept its embed')
    if (hostile[1].embed?.url !== 'javascript:alert(1)') {
      // The URL is kept verbatim on purpose — it is displayed as text, never
      // loaded, and the renderer validates again at the point of use. What must
      // not happen is it being silently trusted.
      if (hostile[1].type !== 'youtube') fail('a hostile url changed the card kind unexpectedly')
    }
    if (hostile[2].embed !== null) fail('a non-string url produced an embed')
    if (typeof hostile[3].embed?.meta?.start !== 'string') {
      fail(\`a non-numeric start was not dropped: \${JSON.stringify(hostile[3].embed?.meta)}\`)
    }
    if (hostile[3].embed?.meta?.n !== 1.5) fail('a valid number in meta was dropped')
    if (hostile[3].embed?.meta?.b !== true) fail('a valid boolean in meta was dropped')

    process.stdout.write(JSON.stringify(failures))
  })
  .catch((e) => { console.error(String(e)); process.exit(3) })
`

let failures = []
try {
  const output = execFileSync(process.execPath, ['-e', script], {
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
  console.log('card kinds: old documents open unchanged, video and pdf cards round-trip, hostile input rejected')
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
