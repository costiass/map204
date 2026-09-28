// Prove scripts/test-viewport-private.cjs fails when the camera starts being shared.
//
// Four re-breakings, one per door, because a guard on three of the four looks exactly
// like a working feature -- which is the failure this file exists to prevent, and
// the one that made the camera shared in the first place.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const TEST = path.join(__dirname, 'test-viewport-private.cjs')

const run = () =>
  require('child_process').execFileSync(process.execPath, [TEST], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Replace, ignoring line endings -- this repo checks out CRLF on Windows. */
function patch(file, from, to) {
  const full = path.join(root, file)
  const original = fs.readFileSync(full, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')
  if (!lf.includes(from)) return null
  const crlf = original.includes('\r\n')
  const out = lf.replace(from, to)
  fs.writeFileSync(full, crlf ? out.replace(/\n/g, '\r\n') : out, 'utf8')
  return () => fs.writeFileSync(full, original, 'utf8')
}

const BREAKS = [
  {
    label: 'the viewport is back in the page signature — panning is an edit again',
    file: 'src/hooks/usePageSync.ts',
    from: '    o: page.ordinal,\n    c: page.elements,',
    to: '    o: page.ordinal,\n    v: page.viewport,\n    c: page.elements,',
    expect: 'pageSignature still includes the viewport',
  },
  {
    label: 'the debounced write saves it again',
    file: 'src/store/supabase-sync.ts',
    from: '      position: LEGACY_PAGE_POSITION,\n      /*',
    to: '      position: LEGACY_PAGE_POSITION,\n      viewport: page.viewport,\n      /*',
    expect: 'savePageSnapshot still writes the viewport',
  },
  {
    label: 'the flush on tab close saves it — the one that always comes back',
    file: 'src/store/supabase-sync.ts',
    from: '        // No `viewport`, and the reason is the same as in `savePageSnapshot` above.',
    to: '        viewport: page.viewport,',
    expect: 'savePageSnapshotKeepalive still writes the viewport',
  },
  {
    label: 'the realtime payload broadcasts it again',
    file: 'src/hooks/usePageSync.ts',
    from: '      ordinal: page.ordinal,\n      elements: page.elements,',
    to: '      ordinal: page.ordinal,\n      viewport: page.viewport,\n      elements: page.elements,',
    expect: 'the realtime payload still carries a viewport',
  },
  {
    label: 'a remote snapshot applies somebody else’s camera',
    file: 'src/utils/merge.ts',
    from: '    viewport: local.viewport,',
    to: '    viewport: remote.viewport ?? local.viewport,',
    expect: "applySnapshot still takes the sender's viewport",
  },
  {
    label: 'the remembered camera is never restored',
    file: 'src/store/useCanvasStore.ts',
    from: 'rememberViewport(state.documentId ?? \'local\', pageId) ?? fallbackViewport(page.viewport)',
    to: 'fallbackViewport(page.viewport)',
    expect: 'nothing restores the remembered camera',
  },
]

let caught = 0
let checked = 0

for (const brk of BREAKS) {
  const restore = patch(brk.file, brk.from, brk.to)
  if (!restore) {
    console.log(`SKIP  ${brk.label}\n      the text to change is not in ${brk.file} -- it has moved`)
    continue
  }
  checked += 1
  try {
    try {
      run()
      console.log(`  ${brk.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes(brk.expect)
      console.log(`  ${brk.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (right) caught += 1
      else console.log(`      ${out.split('\n').find((l) => l.startsWith('FAIL')) || ''}`.slice(0, 200))
    }
  } finally {
    restore()
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
console.log('every file restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
