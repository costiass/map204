// The camera belongs to the reader.
//
// Four claims, and each one was false at some point:
//
//   1. Panning is not an edit        -- it is not in the page signature
//   2. Panning is not saved          -- no write path sends a viewport
//   3. Panning is not broadcast      -- no realtime payload carries one
//   4. A remote snapshot moves nobody -- the merge keeps the local camera
//
// The fifth is the one the reader cannot see and the other four cause: with the
// camera in the shared document, whoever opened a map last decided where the next
// person started, and whoever panned last moved everybody else. Two people in one
// map are looking at two different places -- that is what a map is for.
//
// ## Why a source scan
//
// These are four independent doors, and guarding three of them looks exactly like a
// working feature -- which is the failure this file exists to prevent. There is no
// DOM here to render and no browser to run a camera in, so the claims are checked by
// reading the code that would have to change. That is a weaker claim than "behaves",
// and it is stated as such: a check that says a field is absent from a payload is
// evidence, not proof.
//
// What it does catch is the realistic regression, which is somebody re-adding
// `viewport` to a payload to fix something else and not thinking about this.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let failures = 0
let checked = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/** Code with comments stripped, so prose about a field is not the field. */
function code(file) {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/* -- 1. Panning is not an edit ---------------------------------------------- */

{
  const source = code('src/hooks/usePageSync.ts')
  const start = source.indexOf('function pageSignature')
  checked += 1

  if (start < 0) {
    fail('pageSignature has moved. This file cannot see what decides a write.')
  } else {
    const body = source.slice(start, source.indexOf('}', start))
    if (/viewport/.test(body)) {
      fail(
        'pageSignature still includes the viewport, so panning counts as an edit: ' +
          'every wheel tick queues a save, and a read-only viewer who is allowed to ' +
          'pan takes the document dirty.',
      )
    }
  }
}

/* -- 2. Panning is not saved ------------------------------------------------ */

/*
 * Both write paths, and both are checked because a field left in one of them comes
 * straight back: `savePageSnapshot` is the debounced write and
 * `savePageSnapshotKeepalive` is the flush on tab close, and they are separate
 * bodies that are easy to edit one at a time.
 */
{
  const source = code('src/store/supabase-sync.ts')

  for (const name of ['savePageSnapshot', 'savePageSnapshotKeepalive']) {
    checked += 1
    const start = source.indexOf(`export async function ${name}`)
    if (start < 0) {
      fail(`${name} has moved. This file cannot see what is written to the database.`)
      continue
    }
    // To the next top-level `export`, so a comment or another function's viewport
    // cannot be mistaken for this one's.
    const end = source.indexOf('\nexport ', start + 1)
    const body = source.slice(start, end < 0 ? source.length : end)

    if (/viewport:\s*page\.viewport/.test(body)) {
      fail(
        `${name} still writes the viewport. That is somebody's camera saved as ` +
          "part of the document, so the last person to open the map decides where " +
          'the next person starts.',
      )
    }
  }
}

/* -- 3. Panning is not broadcast -------------------------------------------- */

{
  const source = code('src/hooks/usePageSync.ts')
  checked += 1

  // The payload object literal sent on `page-update`.
  const sent = source.match(/const payload:\s*PageUpdatePayload[\s\S]*?\n\s*}/)
  if (!sent) {
    fail('the broadcast payload has moved. This file cannot see what is sent.')
  } else if (/viewport/.test(sent[0])) {
    fail(
      'the realtime payload still carries a viewport, so moving your camera moves ' +
        "everybody else's. What is shared is content and cursors; a camera is not " +
        'a thing two people can have at once.',
    )
  }
}

/* -- 4. A remote snapshot moves nobody -------------------------------------- */

{
  const source = code('src/utils/merge.ts')
  checked += 1

  const start = source.indexOf('export function applySnapshot')
  if (start < 0) {
    fail('applySnapshot has moved. This file cannot see what a remote change does.')
  } else {
    const body = source.slice(start, source.indexOf('\n}', start))
    if (!/viewport:\s*local\.viewport/.test(body)) {
      fail(
        'applySnapshot does not keep the local viewport. The sending half of the ' +
          'fix is worthless without the receiving half: an older client still puts ' +
          'a viewport in the payload, and this is the code that would apply it.',
      )
    }
    if (/viewport:\s*remote\.viewport/.test(body)) {
      fail("applySnapshot still takes the sender's viewport. That is the bug itself.")
    }
  }
}

/* -- and the default camera agrees with the one the sync layer declares ------ */

/*
 * `viewportStore` declares its own default rather than importing
 * `DEFAULT_PAGE_VIEWPORT` from `supabase-sync`, because that module reads
 * `import.meta.env` at load time and the store imports this one -- so importing it
 * made every bundle of the store fail on a missing `VITE_SUPABASE_URL`. That was
 * not theoretical: `test-read-only.cjs` bundles the store and stopped running.
 *
 * Two copies of one number is exactly the arrangement that rots, so they are
 * compared here rather than trusted.
 */
{
  const store = code('src/store/viewportStore.ts')
  const sync = code('src/store/supabase-sync.ts')
  checked += 1

  const mine = /const DEFAULT_VIEWPORT[^=]*=\s*\{\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+),\s*zoom:\s*(-?[\d.]+)/.exec(store)
  const theirs = /DEFAULT_PAGE_VIEWPORT[^=]*=\s*\{\s*x:\s*(-?[\d.]+),\s*y:\s*(-?[\d.]+),\s*zoom:\s*(-?[\d.]+)/.exec(sync)

  if (!mine) {
    fail('viewportStore.ts has no recognisable DEFAULT_VIEWPORT to compare.')
  } else if (!theirs) {
    fail('DEFAULT_PAGE_VIEWPORT has moved or changed shape in supabase-sync.ts.')
  } else if (mine[1] !== theirs[1] || mine[2] !== theirs[2] || mine[3] !== theirs[3]) {
    fail(
      `the default camera is {${mine[1]},${mine[2]},${mine[3]}} in viewportStore.ts and ` +
        `{${theirs[1]},${theirs[2]},${theirs[3]}} in supabase-sync.ts. They are ` +
        'declared separately on purpose -- importing one into the other breaks every ' +
        'bundle of the store -- so nothing keeps them in step except this.',
    )
  }

  if (/from '@\/store\/supabase-sync'/.test(store)) {
    fail(
      'viewportStore.ts imports supabase-sync again. That module reads import.meta.env ' +
        'at load time, and the store imports viewportStore, so the import makes any ' +
        'bundle of the store need a Supabase URL at runtime.',
    )
  }
}

/* -- and each reader's camera is remembered, and restored -------------------- */

{
  const store = code('src/store/viewportStore.ts')
  checked += 1
  if (!/export function rememberViewport/.test(store) || !/export function recallViewport/.test(store)) {
    fail(
      'viewportStore.ts does not read and write a camera. Without somewhere to keep ' +
        'it, a map opens at the origin every time and the reader loses their place.',
    )
  }

  // Both are wrapped, because localStorage throws in more situations than people
  // expect -- private mode, a full quota, storage disabled by policy -- and a camera
  // is not worth a blank screen.
  const reads = store.slice(store.indexOf('export function rememberViewport'))
  const writes = store.slice(store.indexOf('export function recallViewport'))
  if (!/try\s*\{/.test(reads) || !/catch/.test(reads)) {
    fail('rememberViewport is not wrapped in try/catch, so a full quota breaks the canvas.')
  }
  if (!/try\s*\{/.test(writes) || !/catch/.test(writes)) {
    fail('recallViewport is not wrapped in try/catch, so a full quota breaks the canvas.')
  }

  const store2 = code('src/store/useCanvasStore.ts')
  checked += 1
  if (!/rememberViewport\(/.test(store2)) {
    fail(
      'nothing restores the remembered camera when a page is opened, so the ' +
        "page.viewport left in the document is used -- and that is somebody else's.",
    )
  }
  if (!/recallViewport\(/.test(store2)) {
    fail('nothing records the camera as the reader moves it, so it is never restored.')
  }
}

if (failures === 0) {
  console.log(
    `viewport: ${checked} checks -- panning is not an edit, not a write, not a ` +
      'broadcast, and a remote change moves nobody. Each camera is kept in the ' +
      "reader's own browser.",
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
