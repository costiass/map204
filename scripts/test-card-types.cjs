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
const geometryBundle = path.join(dir, 'geometry.mjs')
const curvesBundle = path.join(dir, 'curves.mjs')

const bundleTo = (entry, out) => {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, entry, '--format', 'esm', '--file', out],
    { stdio: 'pipe' },
  )
}

const asFileUrl = (file) => `pathToFileURL(file).href`

// Bundled whole, with no `--external`: the `@/…` aliases are resolved from
// tsconfig, and marking them external leaves the bundle importing paths that do
// not exist in a `data:` module. An earlier version did that and the test could
// not run at all.
try {
  bundleTo('src/utils/serialize.ts', bundle)
  bundleTo('src/utils/geometry.ts', geometryBundle)
  bundleTo('src/utils/cameraCurves.ts', curvesBundle)
} catch (error) {
  console.log(`FAIL  could not bundle: ${error.stderr ?? error.message}`)
  process.exit(1)
}

// Run in a child process, from a file rather than `node -e`: these checks are
// long enough that the command line hits the OS length limit, and a test that
// cannot be executed is worse than no test. The two bundle URLs go in as
// arguments so the source stays readable and needs no escaping.
const script = `
import { pathToFileURL } from 'node:url'
const [serializePath, geometryPath, curvesPath] = process.argv.slice(2)
Promise.all([
  import(pathToFileURL(serializePath).href),
  import(pathToFileURL(geometryPath).href),
  import(pathToFileURL(curvesPath).href),
])
  .then(([m, g, c]) => {
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
    //
    // Version 1. The migration decides this becomes a note, because a card with
    // no type is a note — that is what it was before kinds existed.
    const legacy = m.parseDoc(JSON.stringify({ version: 1, pages: [{ id: 'p1', cards: [base({})] }] }))
    const legacyCard = legacy.doc.pages[0].elements[0]
    if (legacyCard.kind !== 'note') {
      fail(\`a card with no type became "\${legacyCard.kind}", expected "note"\`)
    }
    if (legacyCard.url !== undefined) {
      fail('a card with no type gained a url')
    }
    if (legacyCard.title !== 'A card' || legacyCard.body !== 'some text') {
      fail('an old card lost its title or its text')
    }

    // --- a video card, round-tripped -------------------------------------
    const video = base({
      type: 'youtube',
      title: 'Lecture 3',
      content: '',
      embed: { url: 'https://youtu.be/dQw4w9WgXcQ', meta: { start: 90 } },
    })
    const json = JSON.stringify({ version: 1, pages: [{ id: 'p1', title: 'T', cards: [video] }] })
    const back = m.parseDoc(json).doc.pages[0].elements[0]
    if (back.kind !== 'video') fail(\`a video card became "\${back.kind}"\`)
    if (back.url !== 'https://youtu.be/dQw4w9WgXcQ') {
      fail(\`the link did not survive: \${back.url}\`)
    }
    if (back.startSeconds !== 90) {
      fail(\`the timestamp did not survive: \${back.startSeconds}\`)
    }

    // Exporting and importing must be the same document.
    const reExported = m.serializeDoc(m.parseDoc(json).doc)
    if (!reExported.includes('youtu.be/dQw4w9WgXcQ')) {
      fail('the link is missing from the re-exported file')
    }
    // And a second round trip must be a fixed point, or an export is lossy in a
    // way nobody finds out about until a file has been saved three times.
    const twice = m.parseDoc(reExported)
    if (m.serializeDoc(twice.doc) !== reExported) {
      fail('a second export of the same document differs from the first')
    }

    // --- a pdf card -------------------------------------------------------
    const pdf = m.parseDoc(JSON.stringify({
      version: 1,
      pages: [{ id: 'p1', cards: [base({ type: 'pdf', embed: { url: 'https://x.test/a.pdf' } })] }],
    })).doc.pages[0].elements[0]
    if (pdf.kind !== 'pdf' || pdf.url !== 'https://x.test/a.pdf') {
      fail(\`a pdf card did not survive: \${pdf.kind} \${pdf.url}\`)
    }

    // --- hostile input in a file -----------------------------------------
    // An imported file is untrusted input, and it can carry anything.
    //
    // Note what the migration does with each of these, because "dropped" is the
    // right answer for all four and it is worth saying why. A video element is a
    // promise that something will play, and a card whose url is not a video
    // cannot keep that promise. Inventing a video element for it — or quietly
    // demoting it to a note — would each be showing the user something they did
    // not write. The file says what it was, the migration says what it could not
    // do, and no element is created.
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
    }))

    if (hostile.doc.pages[0].elements.length !== 0) {
      fail(\`\${hostile.doc.pages[0].elements.length} elements were invented from untranslatable cards\`)
    }
    // Every drop is reported. Silently losing a card is the failure this whole
    // suite exists to prevent, so a drop that produces no warning is a bug.
    if (hostile.warnings.length !== 4) {
      fail(\`4 untranslatable cards produced \${hostile.warnings.length} warnings\`)
    }
    if (!hostile.warnings.some((w) => w.includes('c4'))) {
      fail('a dropped card was not identified by id')
    }

    // --- the same file, with urls that *are* what they claim ------------
    // The other half of the question: a card that survives must come through
    // *clean*, with the hostile "meta" bag ignored rather than half-copied.
    const salvageable = m.parseDoc(JSON.stringify({
      version: 1,
      pages: [{
        id: 'p1',
        cards: [
          base({ type: 'youtube', embed: { url: 'https://youtu.be/dQw4w9WgXcQ', meta: { start: 'nope', n: 1.5, b: true } } }),
          base({ id: 'c2', type: 'pdf', embed: { url: 'https://x.test/a.pdf', meta: 'not an object' } }),
        ],
      }],
    }))
    const salvaged = salvageable.doc.pages[0].elements
    if (salvaged.length !== 2) {
      fail(\`a real video and a real pdf produced \${salvaged.length} elements\`)
    }
    if (salvaged[0]?.kind !== 'video' || salvaged[0]?.url !== 'https://youtu.be/dQw4w9WgXcQ') {
      fail(\`a real video did not survive: \${salvaged[0]?.kind} \${salvaged[0]?.url}\`)
    }
    // A non-numeric timestamp is dropped rather than kept as a string, because
    // the player would be handed something it cannot use. There is no "meta" bag
    // in v2 to smuggle it through.
    if (salvaged[0]?.startSeconds !== null) {
      fail(\`a non-numeric start survived as \${salvaged[0]?.startSeconds}\`)
    }
    if (salvaged[1]?.kind !== 'pdf' || salvaged[1]?.url !== 'https://x.test/a.pdf') {
      fail(\`a pdf did not survive: \${salvaged[1]?.kind} \${salvaged[1]?.url}\`)
    }

    // --- a flash card is a deck of one, and holds no link ----------------
    const flash = m.parseDoc(JSON.stringify({
      version: 1,
      pages: [{
        id: 'p1',
        cards: [
          base({ type: 'flash', title: 'Q?', content: 'A.' }),
          // A file from a world where 'flash' could hold a link. The link is
          // dropped, because a flash card shows text and nothing else — a
          // retained URL would be a field that says one thing and shows another.
          base({ id: 'c2', type: 'flash', embed: { url: 'https://x.test/a.pdf' } }),
        ],
      }],
    })).doc.pages[0].elements
    if (flash[0].kind !== 'flash') fail(\`a flash card became "\${flash[0].kind}"\`)
    // The question is the front. A migration that puts the answer there produces
    // a deck that gives away its own answer, and every card looks correct.
    if (flash[0].cards.length !== 1) {
      fail(\`a flash card became a deck of \${flash[0].cards.length}\`)
    }
    if (flash[0].cards[0][0].text !== 'Q?') {
      fail(\`the front of the deck is "\${flash[0].cards[0][0].text}", expected the question"\`)
    }
    if (flash[0].cards[0][1].text !== 'A.') {
      fail(\`the back of the deck is "\${flash[0].cards[0][1].text}", expected the answer"\`)
    }
    // A flash element has no url field at all — the type does not have one, so
    // this is checked on both cards rather than on the first.
    if (flash.some((f) => f.url !== undefined)) fail('a flash card kept a url')

    /* ================================================================ */
    /* presentation steps                                             */
    /* ================================================================ */

    const docOf = (settings) =>
      m.parseDoc(JSON.stringify({ version: 1, pages: [{ id: 'p1', cards: [] }], settings })).doc

    // A document with no steps at all — every one written before this existed.
    if (docOf(undefined).settings.steps.length !== 0) {
      fail('a document with no steps did not get an empty list')
    }
    if (docOf({}).settings.steps.length !== 0) {
      fail('a document with empty settings did not get an empty list')
    }

    // A step survives with its numbers intact.
    const one = docOf({
      steps: [{ id: 's1', targetId: 'card_1', targetKind: 'card', zoom: 1.4, durationMs: 600 }],
    }).settings.steps
    if (one.length !== 1) fail(\`one step came back as \${one.length}\`)
    if (one[0].targetId !== 'card_1' || one[0].targetKind !== 'element') fail('a step lost its target')
    if (Math.abs(one[0].zoom - 1.4) > 1e-9) fail(\`a step lost its zoom: \${one[0].zoom}\`)
    if (one[0].durationMs !== 600) fail(\`a step lost its duration: \${one[0].durationMs}\`)

    // A step with no id gets one, because a presentation with two steps both
    // called "" cannot be reordered, deleted or jumped to.
    const anonymous = docOf({ steps: [{ targetKind: 'card', targetId: 'c' }] }).settings.steps
    if (!anonymous[0].id) fail('a step with no id did not get one')

    // Duplicate ids would make React keys collide and "remove this step" remove
    // the wrong one. The second copy is dropped rather than renamed, because a
    // silently renamed step points at a different target than the file says.
    const dupes = docOf({
      steps: [
        { id: 's1', targetKind: 'card', targetId: 'a' },
        { id: 's1', targetKind: 'card', targetId: 'b' },
      ],
    }).settings.steps
    if (dupes.length !== 1) fail(\`two steps with the same id became \${dupes.length}\`)
    if (dupes[0].targetId !== 'a') fail('the wrong copy of a duplicated step survived')

    // A page step must not also name a target, or the camera would centre on
    // the named thing while the step claims to show everything.
    const wholePage = docOf({
      steps: [{ id: 's1', targetKind: 'page', targetId: 'card_9' }],
    }).settings.steps
    if (wholePage[0].targetId !== null) fail('a page step kept a target id')

    // An unrecognised kind is an establishing shot, not a broken step.
    const oddKind = docOf({
      steps: [{ id: 's1', targetKind: 'presentation', targetId: 'x' }],
    }).settings.steps
    if (oddKind[0].targetKind !== 'page') fail(\`an unknown kind became "\${oddKind[0].targetKind}"\`)

    // The numbers, which are the ones that move the camera.
    const wild = docOf({
      steps: [
        { id: 'a', targetKind: 'card', zoom: Number.NaN, durationMs: -5 },
        { id: 'b', targetKind: 'card', zoom: 900 },
        { id: 'c', targetKind: 'card', durationMs: 9e9 },
        { id: 'd', targetKind: 'card', zoom: 'fast' },
      ],
    }).settings.steps
    for (const step of wild) {
      if (!Number.isFinite(step.zoom)) fail(\`a step kept a non-finite zoom: \${step.zoom}\`)
      if (step.zoom <= 0) fail(\`a step kept a non-positive zoom: \${step.zoom}\`)
      if (step.zoom > 2.001) fail(\`a step kept a zoom past the limit: \${step.zoom}\`)
      if (!Number.isFinite(step.durationMs) || step.durationMs < 0) {
        fail(\`a step kept a bad duration: \${step.durationMs}\`)
      }
      // Four seconds is the ceiling; anything longer is a hang, not a move.
      if (step.durationMs > 4000) fail(\`a step kept a duration past the limit: \${step.durationMs}\`)
    }
    if (wild[0].durationMs !== 0) fail(\`a negative duration became \${wild[0].durationMs}\`)
    if (wild[2].durationMs !== 4000) fail(\`an absurd duration was not capped: \${wild[2].durationMs}\`)

    // An imported file's steps array can be anything at all.
    for (const bad of [null, 'steps', 42, {}, [null, 3, 'x']]) {
      const got = docOf({ steps: bad }).settings.steps
      if (!Array.isArray(got)) fail(\`steps = \${JSON.stringify(bad)} did not become an array\`)
      if (got.length !== 0) fail(\`steps = \${JSON.stringify(bad)} produced \${got.length} steps\`)
    }

    /* ================================================================ */
    /* a step's transition, trigger and focus                          */
    /* ================================================================ */

    const stepOf = (entry) => docOf({ steps: [entry] }).settings.steps[0]

    // Absent means the defaults, which is what every step made before these
    // fields existed has to keep working as.
    const bare = stepOf({ id: 's', targetKind: 'card', targetId: 'c' })
    if (bare.transition !== 'ease') fail(\`a step with no transition became "\${bare.transition}"\`)
    if (bare.trigger !== 'manual') fail(\`a step with no trigger became "\${bare.trigger}"\`)
    if (bare.focus !== 'none') fail(\`a step with no focus became "\${bare.focus}"\`)

    // An unknown value in an enumerated field falls back rather than dropping
    // the step: an unfamiliar transition is still a step somebody meant.
    for (const field of ['transition', 'trigger', 'focus']) {
      const got = stepOf({ id: 's', targetKind: 'card', [field]: 'teleport' })[field]
      const fallback = field === 'transition' ? 'ease' : field === 'trigger' ? 'manual' : 'none'
      if (got !== fallback) fail(\`an unknown \${field} became "\${got}", expected "\${fallback}"\`)
    }

    // The three combinations that must agree with each other.
    //
    // An instant step has no arrival to animate, so a duration on one is a lie.
    const instant = stepOf({ id: 's', targetKind: 'card', transition: 'instant', durationMs: 900 })
    if (instant.durationMs !== 0) fail(\`an instant step kept a duration: \${instant.durationMs}\`)

    // A step that only moves on a key has no countdown, so a delay on one is
    // a number that is stored and never read.
    for (const trigger of ['manual', 'hold']) {
      const got = stepOf({ id: 's', targetKind: 'card', trigger, autoAdvanceMs: 5000 })
      if (got.autoAdvanceMs !== 0) {
        fail(\`a \${trigger} step kept a countdown: \${got.autoAdvanceMs}\`)
      }
    }
    const timed = stepOf({ id: 's', targetKind: 'card', trigger: 'timed', autoAdvanceMs: 5000 })
    if (timed.autoAdvanceMs !== 5000) fail(\`a timed step lost its delay: \${timed.autoAdvanceMs}\`)

    // A countdown is floored at a second. A step that flashes past in 200ms is
    // not a step, and the floor is also what stops a hand-edited file setting
    // the run to advance faster than a person can read it.
    const tooFast = stepOf({ id: 's', targetKind: 'card', trigger: 'timed', autoAdvanceMs: 50 })
    if (tooFast.autoAdvanceMs < 1000) {
      fail(\`a 50ms countdown was allowed: \${tooFast.autoAdvanceMs}\`)
    }
    const tooSlow = stepOf({ id: 's', targetKind: 'card', trigger: 'timed', autoAdvanceMs: 9e9 })
    if (tooSlow.autoAdvanceMs > 120000) {
      fail(\`an endless countdown was allowed: \${tooSlow.autoAdvanceMs}\`)
    }

    // Every curve a step can name must be a real curve, and every one of them
    // must actually *end* where it aimed. A transition that overshoots on the
    // final frame leaves the camera somewhere the step did not ask for, and
    // the presenter has to press a key to fix it — which is the presentation
    // equivalent of a page that flickers on load.
    for (const name of ['ease', 'drift', 'linear', 'instant']) {
      const curve = c.cameraCurve(name)
      if (Math.abs(curve(0)) > 1e-9) fail(\`\${name} does not start at 0: \${curve(0)}\`)
      if (Math.abs(curve(1) - 1) > 1e-9) fail(\`\${name} does not end at 1: \${curve(1)}\`)
      for (let i = 0; i <= 20; i += 1) {
        const t = i / 20
        const v = curve(t)
        if (!Number.isFinite(v)) fail(\`\${name} gave \${v} at t=\${t}\`)
      }
    }

    // A curve that rises past 1 and comes back is a deliberate overshoot; one
    // that does not is not. Only \`drift\` is allowed to overshoot, and it must
    // overshoot by a *little*: too little is invisible, too much reads as the
    // camera being wrong about where it was going.
    const overshootOf = (name) => {
      const curve = c.cameraCurve(name)
      let peak = 0
      for (let i = 0; i <= 200; i += 1) peak = Math.max(peak, curve(i / 200))
      return peak - 1
    }
    for (const name of ['ease', 'linear']) {
      if (overshootOf(name) > 1e-9) fail(\`\${name} overshoots by \${overshootOf(name)}\`)
    }
    const driftOver = overshootOf('drift')
    if (driftOver <= 0) fail('drift does not overshoot at all, so it is just ease')
    if (driftOver > 0.15) fail(\`drift overshoots by \${driftOver}, which reads as a mistake\`)

    // A curve must not wobble. The camera passing its destination on the way
    // *there* — rather than the one deliberate overshoot at the very end — is
    // what makes a presentation feel like it is fighting itself.
    //
    // \`drift\` is the one exception, and only in the last quarter: it rises past
    // the destination and comes back. So the check is that the only fall
    // anywhere in any curve is inside that window, and that it happens once.
    for (const name of ['ease', 'linear', 'drift']) {
      const curve = c.cameraCurve(name)
      let falls = 0
      let fellBeforeTheEnd = false
      for (let i = 1; i <= 400; i += 1) {
        const t = i / 400
        if (curve(t) < curve((i - 1) / 400) - 1e-9) {
          falls += 1
          if (name !== 'drift' || t <= 0.75) fellBeforeTheEnd = true
        }
      }
      if (fellBeforeTheEnd) fail(\`\${name} wobbles where it should not\`)
      if (name === 'drift' && falls === 0) fail('drift never comes back from its overshoot')
    }

    // Every round trip: these four fields have to survive an export, or a
    // presentation somebody built on another machine arrives with every step
    // set to the defaults.
    const full = docOf({
      steps: [{
        id: 's',
        targetId: 'c',
        targetKind: 'card',
        zoom: 1.5,
        transition: 'linear',
        trigger: 'timed',
        autoAdvanceMs: 8000,
        durationMs: 1200,
        focus: 'spotlight',
      }],
    }).settings.steps[0]
    for (const [key, want] of Object.entries({
      transition: 'linear',
      trigger: 'timed',
      autoAdvanceMs: 8000,
      durationMs: 1200,
      focus: 'spotlight',
      zoom: 1.5,
    })) {
      if (full[key] !== want) fail(\`\${key} did not survive: \${full[key]} instead of \${want}\`)
    }

    /* ================================================================ */
    /* where the camera goes for a step                               */
    /* ================================================================ */

    const size = { width: 1200, height: 800 }
    // A card that fits comfortably: the step's zoom is honoured.
    const small = { x: 0, y: 0, width: 200, height: 120 }
    const close = g.stepViewport(small, size, 1.4)
    if (Math.abs(close.zoom - 1.4) > 1e-6) fail(\`a small card was not shown at 1.4×: \${close.zoom}\`)
    // …and it is centred, which is the point of a step.
    const centreX = size.width / 2 - (small.x + small.width / 2) * close.zoom
    if (Math.abs(close.x - centreX) > 1e-6) fail('a step did not centre its target')

    // A card bigger than the window: the zoom is capped at what fits, because a
    // step that crops the thing it points at is the one thing a presentation
    // cannot do. Asking for 2× on a 3000px card must not zoom to 2×.
    const huge = { x: 0, y: 0, width: 3000, height: 2000 }
    const far = g.stepViewport(huge, size, 2)
    if (!(far.zoom < 2)) fail(\`an oversized card was still zoomed to 2×: \${far.zoom}\`)
    if (far.zoom <= 0.01) fail(\`an oversized card was zoomed out to nothing: \${far.zoom}\`)
    // Whatever the zoom, the whole target has to land inside the viewport.
    const shown = { width: huge.width * far.zoom, height: huge.height * far.zoom }
    if (shown.width > size.width + 1) {
      fail(\`a step cropped its target: \${shown.width}px wide in \${size.width}px\`)
    }
    if (shown.height > size.height + 1) {
      fail(\`a step cropped its target: \${shown.height}px tall in \${size.height}px\`)
    }

    // An establishing shot has no target to keep on screen, so it takes the
    // zoom it was given.
    const wide = g.stepViewport(null, size, 0.75)
    if (Math.abs(wide.zoom - 0.75) > 1e-6) fail(\`a page shot was not taken at 0.75×: \${wide.zoom}\`)

    // A window that has not been measured yet must not produce a viewport that
    // is NaN, which would put the canvas somewhere unrecoverable.
    const unmeasured = g.stepViewport(small, { width: 0, height: 0 }, 1.4)
    for (const value of Object.values(unmeasured)) {
      if (!Number.isFinite(value)) fail(\`an unmeasured window gave \${JSON.stringify(unmeasured)}\`)
    }

    process.stdout.write(JSON.stringify(failures))
  })
  .catch((e) => { console.error(String(e)); process.exit(3) })
`

let failures = []
try {
  // Written to a file rather than passed with `-e`: these checks are long
  // enough that the command line hits the OS length limit, and a test that
  // cannot be executed is worse than no test at all. The two bundle URLs go in
  // as arguments, so the source needs no escaping.
  const scriptFile = path.join(dir, 'checks.mjs')
  fs.writeFileSync(scriptFile, script)
  const output = execFileSync(process.execPath, [scriptFile, bundle, geometryBundle, curvesBundle], {
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
    'card kinds, steps and camera: old documents open unchanged, video/pdf/flash round-trip, hostile input rejected, steps clamped, step zoom never crops its target, every curve lands where it aimed',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
