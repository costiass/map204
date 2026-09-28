// Prove scripts/test-read-only-ui.cjs fails when a guard is removed.
//
// The whole reason this file exists is a guard that was missing, so a check that has
// never been seen to fail is worth very little. Each break below removes one real
// guard from the source and confirms the test notices that specific door.
//
// Three shapes, because they are three different mistakes:
//   1. a guard deleted outright            -- the original bug
//   2. a guard inverted                    -- looks fine, does the opposite
//   3. a whole component hidden for viewers -- what PresentMenu used to do
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'src')
const TEST = path.join(__dirname, 'test-read-only-ui.cjs')

const run = () =>
  require('child_process').execFileSync(process.execPath, [TEST], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/**
 * Apply a replacement, whichever line endings the file happens to use.
 *
 * Git has this repository configured to check out CRLF on Windows, while a file
 * written by a tool may be LF, so the literal text below -- which is LF, because it
 * is easier to read -- matches some of these files and not others. A skip is a
 * silent gap in the verification, and three of the five breaks were skipped the first
 * time this ran for exactly this reason.
 */
function replaceIgnoringEndings(original, from, to) {
  if (original.includes(from)) return original.replace(from, to)
  const lf = original.replace(/\r\n/g, '\n')
  if (!lf.includes(from)) return null
  const patched = lf.replace(from, to)
  return original.includes('\r\n') ? patched.replace(/\n/g, '\r\n') : patched
}

const BREAKS = [
  {
    label: 'the element menu button loses its guard (the original bug)',
    file: 'components/ElementNode.tsx',
    from: '{editable ? (\n          <>\n            <button',
    to: '{true ? (\n          <>\n            <button',
    expect: 'the element menu is reachable by a viewer',
  },
  {
    label: 'the collapse chevron loses its guard',
    file: 'components/ElementNode.tsx',
    from: '{editable ? (\n          <>\n            <button',
    to: '{true ? (\n          <>\n            <button',
    expect: 'the collapse chevron is reachable by a viewer',
  },
  {
    label: 'the resize grip loses its guard',
    file: 'components/ElementNode.tsx',
    from: 'const handles = editable ? (',
    to: 'const handles = true ? (',
    expect: 'the resize grip is reachable by a viewer',
  },
  {
    label: "the group's delete button loses its guard",
    file: 'components/GroupNode.tsx',
    from: '{editable ? (\n          <button\n            type="button"\n            className="cc-group__btn"\n            title="Delete group"',
    to: '{true ? (\n          <button\n            type="button"\n            className="cc-group__btn"\n            title="Delete group"',
    expect: "the delete button is reachable by a viewer",
  },
  {
    label: 'the new-page button loses its guard',
    file: 'components/PageSidebar.tsx',
    from: '{editable ? (\n        <button\n          type="button"\n          className="mx-2 mt-1',
    to: '{true ? (\n        <button\n          type="button"\n          className="mx-2 mt-1',
    expect: 'new page is reachable by a viewer',
  },
  {
    label: 'the Present menu is hidden wholesale again',
    file: 'components/PresentMenu.tsx',
    from: '  const canEditSteps = readOnlyReason !== \'viewing\'',
    to: "  const canEditSteps = readOnlyReason !== 'viewing'\n  if (readOnlyReason === 'viewing') return null",
    expect: 'returns null for a viewer',
  },
  {
    label: 'the group title becomes editable for a viewer again',
    file: 'components/GroupNode.tsx',
    from: 'readOnly={!editable}',
    to: 'readOnly={false}',
    expect: 'group title input is not marked readOnly',
  },
]

let caught = 0
let checked = 0

for (const brk of BREAKS) {
  const file = path.join(src, brk.file)
  const original = fs.readFileSync(file, 'utf8')
  const patched = replaceIgnoringEndings(original, brk.from, brk.to)

  if (patched === null) {
    console.log(`SKIP  ${brk.label}\n      the text to change is not in ${brk.file} -- it has moved`)
    continue
  }
  checked += 1

  fs.writeFileSync(file, patched, 'utf8')
  try {
    try {
      run()
      console.log(`  ${brk.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const right = out.includes(brk.expect)
      console.log(`  ${brk.label}\n      ${right ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (!right) console.log(`      ${out.split('\n').find((l) => l.startsWith('FAIL')) || ''}`.slice(0, 200))
      if (right) caught += 1
    }
  } finally {
    fs.writeFileSync(file, original, 'utf8')
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
console.log('every file restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
