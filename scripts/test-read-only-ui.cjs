// Read-only, at the level of the interface rather than the store.
//
// `test-read-only.cjs` runs the real store and asserts the state machine: a viewer
// is locked, presenting locks, stopping unlocks, a viewer's lock survives. That is
// the right place for those claims and it passes.
//
// It cannot catch the failure that actually happened, because the failure was never
// in the store. The store refused every write the whole time. What it did not do was
// stop the interface *offering* them: a viewer had a collapse chevron, an element
// menu leading to rename and delete, a group's delete button, an editable group
// title field, four connection anchors and a resize grip on every card. Every one of
// those was a door the store would slam shut, and a viewer is right to be annoyed by
// a door that does not open.
//
// So this file enumerates the doors by reading the components, and asserts that each
// write affordance sits inside a read-only conditional.
//
// ## What this is and is not
//
// It is a source scan, not a rendering test. It checks that a guard is *written*
// around an affordance, not that it behaves. A guard on the wrong sibling would pass
// here. That is a real limitation and the trade is deliberate -- a DOM test would need
// a renderer and a test library this project does not have, and would still have to
// be told where to look. What this buys is that adding a button to a card becomes a
// decision rather than an oversight, which is the failure being guarded.
//
// The check is deliberately simple: within a window above the affordance, the read-only
// flag must open a conditional. An earlier version tried to walk braces backwards to
// find the enclosing expression and reported every door in the project as ungated --
// because the nearest brace before `onClick={() => addElement('note')}` is the arrow
// function's, not the ternary's. Simple and slightly blunt beats clever and wrong.
//
// Markers name the *affordance* rather than the action it performs. The affordance is
// what a viewer can reach; the action may be called from a handler defined far away.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'src')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/** Code with the comments stripped -- the prose here names every door and flag. */
function code(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** How far above an affordance its guard may sit. A ternary arm is a handful of lines. */
const WINDOW = 30

/**
 * Does the flag appear in a conditional within the window above the affordance?
 *
 * Both polarities, because both are correct ways to guard and a checker that only
 * understood one of them reported three properly-guarded controls as open:
 *
 *   `editable ? (`      the affordance is one arm of a conditional
 *   `!editable ||`      the handler is undefined unless it is editable
 *
 * The first version of this matched only `{editable ?`, and so missed both a
 * `const handles = editable ? (` and a negated guard -- which is a check that fails
 * on correct code, and a check that fails on correct code gets deleted.
 */
/**
 * A guard: the flag deciding whether the code below it runs at all.
 *
 * Both shapes are accepted, because both are correct and a checker that understood
 * only one reported three properly-guarded controls as open:
 *
 *   `{editable ? (`      the affordance is one arm of a JSX conditional
 *   `!editable || x`     the handler is defined as undefined unless editable
 *
 * Two things it must *not* accept, and both were live false-negatives:
 *
 *   `data-editable={editable ? 'true' : 'false'}`
 *       The lookbehind excludes `-` so the attribute name cannot match -- but the
 *       flag inside it is preceded by `{`, so that alone is not enough. It is
 *       excluded by requiring *code* after the operator rather than a string, which
 *       is also what separates a real guard from a value.
 *
 *   `disabled={!editable || !canUndo}`
 *       An operator followed by `!` is a condition, not an arm. Counting it as a
 *       guard would have hidden a door.
 */
const guardOn = (flag) =>
  new RegExp(`(?<![\\w$-])!?\\s*${flag}\\s*(?:\\?|\\|\\||&&)\\s*(?![\\'"\`])[(<A-Za-z_$]`, 'g')

/**
 * Tokens that mean a conditional or JSX block *closed* above here.
 *
 * Without these the window check is too generous: the "New page" button sits within
 * thirty lines of the delete-page button's `{editable ? (`, so a naive window said
 * it was guarded when its own guard had been deleted. That is the failure mode that
 * matters for this file -- a check that passes on an unguarded button -- so the
 * nearest closing token above the affordance has to be *nearer* than the nearest
 * guard opening, or the guard is not the one containing it.
 */
/**
 * A token that means a conditional or JSX block *closed*.
 *
 * `) : anything` is not enough on its own, and the group header is why. A guard
 * written as a multi-line attribute value closes like this:
 *
 *     onPointerDown={
 *       editable
 *         ? (event) => { ... }
 *         : undefined
 *     }
 *
 * where the token before the colon is a `}`, and it is on the *previous line*. So
 * both a `)` and a `}` count, and a newline may sit between the brace and the colon.
 * Without the `}` the group's delete button looked guarded by the header's
 * pointer-down handler, which had already closed.
 */
const CLOSES_A_BLOCK = /[)}]\s*(?:\n\s*)?:\s*[^\s)]|\}<\/>/g

/** Every affordance and every shape examined, for the count at the end. */
let checked = 0

/** The flag the component-level checks look for. */
const EDITABLE = 'editable'

/** The flag `PresentMenu` splits on, since a viewer may present but not author. */
const CAN_EDIT_STEPS = 'canEditSteps'

/**
 * Why `guarded` said no, in one line.
 *
 * A source check that fails without saying what it saw is a check you have to
 * re-derive from scratch, and this one failed on a control that *was* correctly
 * gated. So the two offsets are reported: the nearest guard opening above the marker
 * and the nearest block close above it. Guard below close is the condition for
 * "gated", so when it fails the answer is usually that a closer was mistaken for
 * the arm this marker lives in -- or the reverse.
 */
function explain(source, marker, flag) {
  const box = region(source, marker)
  if (!box) return 'the marker was not found at all'

  const above = box.before
  let lastGuard = -1
  let lastClose = -1
  let m

  const guard = new RegExp(guardOn(flag).source, 'g')
  while ((m = guard.exec(box.search)) !== null) lastGuard = m.index

  const closes = new RegExp(CLOSES_A_BLOCK.source, 'g')
  while ((m = closes.exec(box.before)) !== null) lastClose = m.index

  if (lastGuard < 0) {
    return (
      `no ${flag} conditional anywhere above it in the window. The text directly ` +
      `above the marker is ${JSON.stringify(above.slice(-70))}`
    )
  }
  if (lastClose > lastGuard) {
    return (
      `a block closed ${lastClose - lastGuard} chars *after* the nearest guard, so ` +
      'that guard belongs to something else. Before it: ' +
      JSON.stringify(above.slice(Math.max(0, lastClose - 60), lastClose + 20))
    )
  }
  return `nearest guard is ${lastGuard - lastClose} chars below the nearest close`
}

/* -- the checker, checked --------------------------------------------------- */

/*
 * The pattern above is the load-bearing part of this file, and it is a regex built
 * by string concatenation from a template literal -- so a mistake in it does not
 * throw, it matches *nothing*, and the whole file passes while checking nothing.
 *
 * That is not hypothetical. It happened twice while writing this: a pattern that
 * did not match `{editable ? <SaveIndicator /> : null}` reported a correctly-gated
 * control as open, and a probe written to investigate it disagreed with the test
 * because the probe had read the pattern out of the template literal without
 * evaluating the escapes.
 *
 * So the shapes are asserted here, against the same `guardOn` the checks use. A
 * pattern that stops matching fails this rather than silently approving everything.
 */
{
  const SHAPES = [
    // [snippet, is it a guard?]
    ['{editable ? <SaveIndicator /> : null}', true],
    ['{editable ? (\n  <button />\n) : null}', true],
    ['{editable && <X />}', true],
    ['const handles = editable ? (', true],
    ['onPointerDown={\n  !editable || x\n    ? undefined\n    : handler\n}', true],
    // Not guards, and each of these was a real false negative.
    ["data-editable={editable ? 'true' : 'false'}", false],
    ['const editable = readOnlyReason === null', false],
    ['disabled={!editable || !canUndo}', false],
    /*
     * True, and worth being explicit about why. This *is* a conditional on the
     * flag -- just not one that wraps whatever comes next. The pattern finds it;
     * `guarded()` rejects it, because the arm closes at `) : undefined` two
     * characters after it opens and the marker is past that.
     *
     * The pattern and the position rule answer different questions -- "is the flag
     * tested here?" and "does that test wrap the thing?" -- and only the second one
     * decides whether a control is gated.
     */
    ['onPointerDown={editable ? (event) => handler(event) : undefined}', true],
  ]

  for (const [snippet, expected] of SHAPES) {
    checked += 1
    // Only the guard pattern matters here: `) : undefined}` closes the arm two
    // characters after it opens, which is exactly why that last case is not a guard
    // for whatever comes next, and it is why the rule below also compares positions.
    const isGuard = guardOn('editable').test(snippet)
    if (isGuard !== expected) {
      fail(
        `the guard pattern ${isGuard ? 'matches' : 'does not match'} ${JSON.stringify(snippet)}, ` +
          `which it should ${expected ? '' : 'not '}(-)match.\n      If this fires, every other ` +
          'check in this file is untrustworthy: a pattern that stops matching approves ' +
          'everything.',
      )
    }
  }

  /*
   * And `guarded` itself, on whole synthetic sources -- because the pattern being
   * right is not the same as the *position rule* being right, and the two failed
   * independently while this file was being written.
   *
   * The first is the one that bit: a guard written immediately before the marker,
   * with the search region stopping at the marker, could not see the character
   * after its `?` and so reported `{editable ? <SaveIndicator /> : null}` as
   * ungated. A pattern-only self-check cannot express that, because in a bare
   * snippet the character after `?` is always there.
   */
  const PLACEMENTS = [
    // [source, marker, gated?]
    ['{editable ? <SaveIndicator /> : null}', '<SaveIndicator />', true],
    ['{editable ? (\n  <SaveIndicator />\n) : null}', '<SaveIndicator />', true],
    ['<SaveIndicator />', '<SaveIndicator />', false],
    // A guard above, but closed before the marker: it belongs to a sibling.
    [
      'onPointerDown={editable ? (e) => h(e) : undefined}\n<SaveIndicator />',
      '<SaveIndicator />',
      false,
    ],
    // A guard above and closed, then the real one wrapping the marker.
    [
      'a={editable ? x : undefined}\n{editable ? <SaveIndicator /> : null}',
      '<SaveIndicator />',
      true,
    ],
  ]

  for (const [source, marker, expected] of PLACEMENTS) {
    checked += 1
    const got = guarded(source, marker, EDITABLE)
    if (got !== expected) {
      fail(
        `guarded() said ${got ? 'gated' : 'ungated'} for ${JSON.stringify(source)}, ` +
          `which it should ${expected ? '' : 'not '}(-)be. ` +
          explain(source, marker, EDITABLE),
      )
    }
  }
}

/**
 * Is the marker guarded, and is the guard the one containing it?
 *
 * Not "is there a guard nearby" -- that was true for every control on every card,
 * because a card carries `data-editable={editable ? ...}`, `onContextMenu={editable
 * ? ...}` and `onPointerDown={!editable || ...}` above its own controls. Deleting the
 * guard around the element menu -- the original bug, this file's whole subject --
 * still passed.
 *
 * The rule that survives that: the *nearest* guard above the marker must be lower
 * than the *nearest* block close above it. If a guard opened and then closed before
 * reaching the marker, that guard was for something else.
 *
 * Two earlier attempts and why they went:
 *   - a character window, which counted a sibling attribute's guard;
 *   - paren-depth containment, which is right for `{editable ? (<div>` and wrong
 *     for the commoner `cond ? undefined : handler`, because the marker sits in an
 *     arrow-function body, *after* the closing paren of the arm.
 */
/**
 * The text the guard is searched in, which *includes* the marker.
 *
 * This is the whole subtlety. The guard pattern needs a character after its `?` --
 * it has to see that what follows is code rather than a string literal -- and when
 * the region stopped at the marker, a guard written immediately before it was
 * invisible: `{editable ? <SaveIndicator />` searched up to `<SaveIndicator`
 * left a dangling `?` with nothing after it, and `{editable ? <SaveIndicator />`
 * was reported as ungated while being gated perfectly correctly.
 *
 * Including the marker completes the guard without opening the door to one *after*
 * it, because the search still stops at the marker's last character.
 */
function region(source, marker) {
  const at = source.indexOf(marker)
  if (at < 0) return null
  return {
    at,
    search: source.slice(Math.max(0, at - WINDOW * 80), at + marker.length),
    before: source.slice(Math.max(0, at - WINDOW * 80), at),
  }
}

function guarded(source, marker, flag) {
  const box = region(source, marker)
  if (!box) return false

  // Fresh regexes per call, or `lastIndex` carries over and the scan resumes
  // halfway through the string.
  let lastGuard = -1
  let lastClose = -1
  let match

  const guard = new RegExp(guardOn(flag).source, 'g')
  while ((match = guard.exec(box.search)) !== null) lastGuard = match.index

  // Closes are searched only *before* the marker: a `) : null}` inside the marker
  // is not a block that closed above it.
  const closes = new RegExp(CLOSES_A_BLOCK.source, 'g')
  while ((match = closes.exec(box.before)) !== null) lastClose = match.index

  return lastGuard > lastClose
}

/* -- the doors -------------------------------------------------------------- */

const CHECKS = [
  {
    file: 'components/ElementNode.tsx',
    flag: EDITABLE,
    doors: [
      { what: 'the collapse chevron', marker: "toggleElementCollapsed([element.id])", why: 'collapsing an element is a write and is saved' },
      { what: 'the element menu', marker: 'onClick={openMenu}', why: 'the menu is the front door to rename, duplicate and delete' },
      { what: 'the connection anchors', marker: 'onHandlePointerDown(event, element.id, side)', why: 'starting a connection draws one' },
      { what: 'the resize grip', marker: 'onResizePointerDown(event, element.id)', why: 'resizing an element is a write' },
      { what: 'the body press that selects', marker: 'onElementPointerDown(event, element.id)', why: 'selection is a write: it opens the inspector, which edits' },
    ],
  },
  {
    file: 'components/GroupNode.tsx',
    flag: EDITABLE,
    doors: [
      { what: 'the delete button', marker: 'title="Delete group"', why: 'deleting is a write' },
      { what: 'the connection anchors', marker: 'onHandlePointerDown(event, group.id, side)', why: 'starting a connection draws one' },
      { what: 'the resize grip', marker: 'onResizePointerDown(event, group.id)', why: 'resizing a group is a write' },
    ],
  },
  {
    file: 'components/PageSidebar.tsx',
    flag: EDITABLE,
    doors: [
      { what: 'rename page', marker: 'title="Rename page"', why: 'a write' },
      { what: 'delete page', marker: 'title="Delete page"', why: 'a write' },
      { what: 'new page', marker: 'onClick={() => addPage()}', why: 'a write the database would refuse anyway' },
    ],
  },
  {
    file: 'components/Toolbar.tsx',
    flag: EDITABLE,
    doors: [
      { what: 'the Card button', marker: 'title="New note (C)"', why: 'creating is a write' },
      { what: 'the Group button', marker: 'title="New group (G)"', why: 'creating is a write' },
    ],
  },
  {
    file: 'components/PresentMenu.tsx',
    flag: CAN_EDIT_STEPS,
    doors: [
      { what: 'edit the steps', marker: 'Edit the steps', why: 'the steps live in the document' },
      { what: 'add a step for the selection', marker: 'Add step for selection', why: 'a write' },
      { what: 'add a step for the page', marker: 'Add step for the whole page', why: 'a write' },
      { what: 'remove a step', marker: 'title="Remove this step"', why: 'a write' },
      { what: 'move a step up', marker: 'title="Move up"', why: 'a write' },
      { what: 're-capture a step zoom', marker: "title=\"Take this step's zoom from the current view\"", why: 'a write' },
    ],
  },
]

for (const group of CHECKS) {
  const source = code(group.file)
  for (const door of group.doors) {
    checked += 1

    if (!source.includes(door.marker)) {
      fail(
        `${group.file}: ${door.what} is gone (${door.marker} not found). If it was ` +
          'removed on purpose, delete this check as well -- a check for a door that ' +
          'no longer exists passes forever and hides the next one.',
      )
      continue
    }

    if (!guarded(source, door.marker, group.flag)) {
      fail(
        `${group.file}: ${door.what} is reachable by a viewer -- ${door.why}, and it ` +
          `is not inside a \`${group.flag}\` conditional. The store refuses the write, ` +
          'so this is a control that does nothing rather than a way to change the ' +
          'document, which reads as a broken interface rather than a restricted one.',
      )
    }
  }
}

/* -- the other half: a viewer must keep what does not write ------------------- */

/*
 * It is as easy to over-correct as to under-correct. Hiding everything makes a viewer
 * unable to do anything at all, which is not read-only, it is broken -- and the
 * complaint it replaces is milder than the one it causes.
 *
 * Existence only, and that is a smaller claim than it looks like. Whether a control
 * is actually reachable for a viewer needs a rendered tree, which this project has no
 * way to produce, and a check that pretended otherwise would be the kind that passes
 * while checking nothing. The one claim here that *is* mechanical is the last one:
 * that the Present menu is not hidden wholesale.
 */
const KEPT = [
  {
    file: 'components/PresentMenu.tsx',
    what: 'starting a presentation',
    marker: 'startPresenting()',
    why: 'presenting moves a camera and reads steps; it writes nothing',
  },
  {
    file: 'components/PresentMenu.tsx',
    what: 'presenting from a given step',
    marker: 'startPresenting(step.id)',
    why: 'a viewer who can start a presentation should be able to start it anywhere',
  },
  {
    file: 'components/Toolbar.tsx',
    what: 'zoom',
    marker: 'zoomBy(1 / 1.2)',
    why: 'a viewer who cannot move the camera is looking at a picture, not a map',
  },
  {
    file: 'components/Toolbar.tsx',
    what: 'the snap-to-grid toggle',
    marker: 'title="Snap to grid"',
    why: 'a grid preference is local to the reader, not a property of the document',
  },
]

for (const kept of KEPT) {
  checked += 1
  if (!code(kept.file).includes(kept.marker)) {
    fail(`${kept.file}: ${kept.what} is gone. ${kept.why}.`)
  }
}

/*
 * The one regression here that is worth a real assertion, because it is exactly what
 * this file's subject was: the Present menu used to `return null` for a viewer, which
 * took "start presenting" with it. So a viewer could not run the presentation the map
 * was built for -- and the fix was to gate the step-building instead.
 *
 * A blanket early return is a distinctive enough shape to look for.
 */
{
  const source = code('components/PresentMenu.tsx')
  checked += 1
  const hidden = /if\s*\([^)]*readOnlyReason[^)]*\)\s*return null/.test(source)
  if (hidden) {
    fail(
      'components/PresentMenu.tsx: the menu returns null for a viewer. A viewer must ' +
        'be able to *start* a presentation -- it writes nothing. The step-building ' +
        'below it is what should be gated, and it is.',
    )
  }
}

/* -- and a viewer is told about nothing --------------------------------------- */

/*
 * The save state and the write-failure toasts.
 *
 * Two places, and the same argument in both: a viewer has no writes, so a report
 * *about* writes is noise. Left in place, a guest watching somebody else edit a map
 * watches a save indicator spinning for changes they did not make and gets an error
 * toast for a refusal the app arranged on purpose -- and the reasonable conclusion
 * is that Map204 is broken rather than that it is correctly refusing them.
 */
const SILENT = [
  {
    file: 'components/Toolbar.tsx',
    what: 'the save indicator',
    marker: '<SaveIndicator />',
    why: 'it reports on writes, and a viewer has none',
  },
]

for (const quiet of SILENT) {
  const source = code(quiet.file)
  checked += 1
  if (!source.includes(quiet.marker)) {
    fail(`${quiet.file}: ${quiet.what} is gone entirely (${quiet.marker} not found).`)
    continue
  }
  if (!guarded(source, quiet.marker, EDITABLE)) {
    fail(
      `${quiet.file}: ${quiet.what} is shown to a viewer. ${quiet.why}, so it reports ` +
        `on somebody else's changes.\n      ${explain(source, quiet.marker, EDITABLE)}`,
    )
  }
}

/* -- and the group title is readable but not writable ------------------------ */

/*
 * Special-cased because the right answer is neither "an input" nor "not an input". A
 * group's name has to stay visible and has to stay in the accessibility tree as that
 * group's name, so it cannot be removed; and it must not be focusable into an edit,
 * so it cannot stay an editable field. The generic scan above has nothing to say
 * about it -- the input's presence is not a bug -- so it is checked on its own.
 */
{
  const source = code('components/GroupNode.tsx')
  checked += 1
  if (!/readOnly=\{!editable\}/.test(source)) {
    fail(
      'components/GroupNode.tsx: the group title input is not marked readOnly for a ' +
        'viewer. It must stay an input -- it is how the name is read, and the ' +
        "accessible name of the group -- but `readOnly={!editable}` is what stops it " +
        'being focused into an edit.',
    )
  }
}

if (failures === 0) {
  console.log(
    `read-only interface: ${checked} affordances checked, every write gated and ` +
      'everything a guest is owed still there',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
