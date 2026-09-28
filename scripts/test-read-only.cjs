// Read-only and presenting, as a state machine.
//
// The promise this feature makes is simple to state and easy to get wrong: a
// canvas that cannot be edited must not be editable *by any route*. Dragging,
// resizing, connecting, undo, delete, and the keyboard are five separate doors,
// and a guard on four of them looks exactly like a working feature.
//
// Two things are asserted here that are easy to get backwards:
//
//   1. A viewer is locked by *permission*, so stopping a presentation must not
//      unlock them. The lock survives, because the permission that set it is
//      still in force.
//   2. Opening a different workspace must not carry the lock with you. Being a
//      viewer of one map says nothing about the one you just opened.
//
// The store is run for real, in a child process, because the thing being tested
// is the interaction between the state, the actions and the document — a copy of
// the rules would agree with itself whatever the code did.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-'))
const bundle = path.join(dir, 'store.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/store/useCanvasStore.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle the store: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const script = `
import { pathToFileURL } from 'node:url'
import(pathToFileURL(process.argv[2]).href)
  .then(({ useCanvasStore }) => {
    const failures = []
    const fail = (msg) => failures.push(msg)
    const s = () => useCanvasStore.getState()

    const pageId = s().activePageId
    const page = () => s().doc.pages.find((p) => p.id === pageId)

    /* --- the default is an editable canvas ---------------------------- */
    if (s().readOnlyReason !== null) fail('a fresh canvas was not editable')
    if (!s().canEdit()) fail('canEdit() was false on a fresh canvas')
    if (s().presenting) fail('a fresh canvas was presenting')

    /* --- a viewer is locked, and the lock has a name ------------------ */
    s().setDocumentRole('viewer')
    if (s().readOnlyReason !== 'viewing') {
      fail(\`a viewer was not locked: \${s().readOnlyReason}\`)
    }
    if (s().canEdit()) fail('canEdit() was true for a viewer')
    if (s().presenting) fail('being a viewer started a presentation')

    /* --- ...and the lock is NOT theirs to switch off ------------------ */
    // This is the failure that matters. If a viewer's lock could be lifted by
    // the same code path a presenter uses, then a viewer could present, and
    // presenting hands them a way to change the document.
    s().startPresenting()
    if (!s().presenting) fail('a viewer could not start a presentation')
    s().stopPresenting()
    if (s().readOnlyReason === null) {
      fail('stopping a presentation unlocked a viewer')
    }
    if (s().readOnlyReason !== 'viewing') {
      fail(\`a viewer's lock was replaced by "\${s().readOnlyReason}"\`)
    }
    if (s().canEdit()) fail('a viewer could edit after presenting')

    /* --- an editor is not locked by anything -------------------------- */
    s().setDocumentRole('editor')
    if (s().readOnlyReason !== null) fail('an editor was left locked')
    if (!s().canEdit()) fail('canEdit() was false for an editor')

    /* --- presenting locks, and stopping unlocks ----------------------- */
    s().startPresenting()
    if (!s().presenting) fail('startPresenting did not set presenting')
    if (s().readOnlyReason !== 'presenting') {
      fail(\`presenting did not lock: \${s().readOnlyReason}\`)
    }
    if (s().canEdit()) fail('the canvas was editable while presenting')
    s().stopPresenting()
    if (s().presenting) fail('stopPresenting did not clear presenting')
    if (s().readOnlyReason !== null) fail('stopping a presentation left the canvas locked')
    if (!s().canEdit()) fail('the canvas was not editable after presenting')

    /* --- the lock does not follow you to another workspace ------------- */
    s().setDocumentRole('viewer')
    s().hydrateDocument({
      version: 1,
      pages: s().doc.pages.map((p) => ({ ...p, cards: [], groups: [], connections: [] })),
      settings: { ...s().doc.settings },
    })
    if (s().readOnlyReason === 'viewing') {
      fail("a viewer's lock followed them into another workspace")
    }

    // …but the role read for the new workspace sets it again, which is the
    // whole reason the lock lives with the role rather than being a one-off.
    s().setDocumentRole('viewer')
    if (s().readOnlyReason !== 'viewing') fail('the role no longer sets the lock')

    /* --- steps, and the camera they ask for --------------------------- */
    s().setDocumentRole('owner')
    s().hydrateDocument({
      version: 1,
      pages: s().doc.pages.map((p) => ({ ...p, cards: [], groups: [], connections: [] })),
      settings: { ...s().doc.settings, steps: [] },
    })
    s().setViewportSize({ width: 1200, height: 800 })

    // A workspace with no steps cannot be presented: there is nothing to show,
    // and the button says so rather than starting a blank screen.
    const before = s().cameraRequest.token
    s().startPresenting()
    if (s().cameraRequest.token !== before) {
      fail('presenting an empty step list still moved the camera')
    }
    s().stopPresenting()

    const stepA = s().addStep({ targetId: null, targetKind: 'page', zoom: 0.8, durationMs: 300 })
    const stepB = s().addStep({ targetId: null, targetKind: 'page', zoom: 1.2, durationMs: 300 })
    const stepC = s().addStep({ targetId: null, targetKind: 'page', zoom: 1.6, durationMs: 300 })
    if (s().steps().length !== 3) fail(\`three steps became \${s().steps().length}\`)

    /* --- the run walks forward, and stops at the end ------------------ */
    s().startPresenting()
    if (s().stepIndex !== 0) fail(\`a presentation started at \${s().stepIndex}\`)

    s().nextStep()
    if (s().stepIndex !== 1) fail(\`next went to \${s().stepIndex}\`)
    s().nextStep()
    if (s().stepIndex !== 2) fail(\`next went to \${s().stepIndex}\`)

    // At the last step, "next" finishes rather than wrapping. A loop that
    // silently restarts looks like the app forgetting which slide it was on.
    s().nextStep()
    if (s().presenting) fail('next at the last step did not finish the presentation')
    if (s().stepIndex === 2) fail('finishing left the run on the last step')

    // Backwards stops at the first, for the same reason.
    s().startPresenting(stepB)
    if (s().stepIndex !== 1) fail(\`starting from a step landed on \${s().stepIndex}\`)
    s().prevStep()
    if (s().stepIndex !== 0) fail(\`prev went to \${s().stepIndex}\`)
    s().prevStep()
    if (s().stepIndex !== 0) fail(\`prev went before the first step: \${s().stepIndex}\`)

    /* --- every step move asks for a camera --------------------------- */
    // A step that did not move the camera would present the previous slide
    // while the counter says otherwise.
    s().startPresenting()
    let token = s().cameraRequest.token
    s().goToStep(0)
    const t0 = s().cameraRequest.token
    s().goToStep(2)
    const t2 = s().cameraRequest.token
    if (t2 <= t0) fail('moving to a later step did not ask the camera to move')
    if (Math.abs(s().cameraRequest.viewport.zoom - 1.6) > 1e-6) {
      fail(\`a 1.6 step was shown at \${s().cameraRequest.viewport.zoom}\`)
    }
    s().goToStep(99)
    if (s().stepIndex !== 2) fail(\`an out-of-range step landed on \${s().stepIndex}\`)
    s().stopPresenting()
    void token

    /* --- reordering keeps the list consistent ------------------------- */
    s().moveStep(stepC, -1)
    const order = s().steps().map((step) => step.id)
    if (order[1] !== stepC || order[2] !== stepB) {
      fail(\`reordering gave \${JSON.stringify(order)}\`)
    }
    // Off the ends of the list is a no-op, not a wrap.
    s().moveStep(stepA, -1)
    if (s().steps()[0].id !== stepA) fail('moving the first step up wrapped it round')
    s().moveStep(order[2], 1)
    if (s().steps()[2].id !== order[2]) fail('moving the last step down wrapped it round')

    /* --- deleting a step before the current one does not skip forward -- */
    s().startPresenting(order[2])
    const atEnd = s().stepIndex
    s().removeStep(order[0])
    if (s().stepIndex >= s().steps().length) {
      fail(\`deleting an earlier step left the run at \${s().stepIndex} of \${s().steps().length}\`)
    }
    if (atEnd < 0) fail('the run was not on a step')
    s().stopPresenting()

    /* --- a step pointing at a card that no longer exists -------------- */
    s().addStep({ targetId: 'card_that_was_deleted', targetKind: 'card', zoom: 1.5, durationMs: 200 })
    const beforeDead = s().cameraRequest.token
    s().goToStep(s().steps().length - 1)
    if (s().cameraRequest.token === beforeDead) {
      fail('a step with no target did not move the camera at all')
    }
    const dead = s().cameraRequest.viewport
    for (const value of Object.values(dead)) {
      if (!Number.isFinite(value)) fail(\`a dead target gave \${JSON.stringify(dead)}\`)
    }

    process.stdout.write(JSON.stringify(failures))
  })
  .catch((e) => { console.error(String(e && e.stack || e)); process.exit(3) })
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
    'read-only: a viewer stays locked through presenting, the lock does not follow you to another workspace, steps walk forward and stop at the end',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
