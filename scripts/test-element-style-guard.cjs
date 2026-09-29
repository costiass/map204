const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const TEST = path.join(__dirname, 'test-element-style.cjs')

const run = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function patch(file, from, to) {
  const full = path.join(root, file)
  const original = fs.readFileSync(full, 'utf8')
  const lf = original.replace(/\r\n/g, '\n')
  if (from === '' || !lf.includes(from)) return null
  const patched = lf.replace(from, to)
  if (patched === lf) return null
  const crlf = original.includes('\r\n')
  fs.writeFileSync(full, crlf ? patched.replace(/\n/g, '\r\n') : patched, 'utf8')
  return () => fs.writeFileSync(full, original, 'utf8')
}

const NODE = 'src/components/ElementNode.tsx'
const TAB = 'src/components/ElementInspectorTab.tsx'

const BREAKS = [
  {
    label: "the original bug: a non-note's style is thrown away and the note default drawn",
    file: NODE,
    from: '  const elementStyle = element.style ??',
    to: "  const elementStyle = element.kind === 'note' ? element.style : DEFAULT_NOTE_STYLE ??",
    expect: "a non-note's style as the note default",
  },
  {
    label: 'the shadow flag goes back to the note default',
    file: NODE,
    from: "data-shadow={elementStyle.shadow ? 'true' : 'false'}",
    to: "data-shadow={(element.kind === 'note' ? element.style : DEFAULT_NOTE_STYLE).shadow ? 'true' : 'false'}",
    expect: 'drop shadow still comes from the note default',
  },
  {
    label: 'a link goes back to drawing "not implemented yet"',
    file: NODE,
    from: "      if (element.kind === 'link') return <LinkBody element={element} />\n\n      return <p className=\"cc-card__body opacity-60\">Nothing to show.</p>",
    to: "      return <p className=\"cc-card__body opacity-60\">A link element is not implemented yet.</p>",
    expect: 'not implemented yet',
  },
  {
    label: 'the link inspector is removed, so the kind falls through',
    file: TAB,
    from: "    case 'link':\n      return <LinkInspector element={element} onChange={updateElement} onCommit={flushCommit} />\n",
    to: '',
    expect: 'link element has no inspector',
  },
  {
    // The break that was here added a comment, which changed nothing and which the
    // test correctly ignored. A break has to alter what the code does.
    label: 'the settings panel is gated back to notes only',
    file: 'src/components/Inspector.tsx',
    from: "          {tab === 'settings' ? (\n            <ElementSettingsTab key={card.id} element={card} />",
    to: "          {tab === 'settings' && card.kind === 'note' ? (\n            <ElementSettingsTab key={card.id} element={card} />",
    expect: 'gated on the element being a note',
  },
]

let caught = 0
let checked = 0
let skipped = 0

for (const brk of BREAKS) {
  const restore = patch(brk.file, brk.from, brk.to)
  if (!restore) {
    console.log(`SKIP  ${brk.label}\n      the text is not in ${brk.file} -- it has moved`)
    skipped += 1
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
      else {
        const first = out.split('\n').find((l) => l.trim().startsWith('FAIL'))
        console.log(`      ${(first || '').trim().slice(0, 180)}`)
      }
    }
  } finally {
    restore()
  }
}

console.log(`\n${caught} of ${checked} deliberate breaks were caught.`)
if (skipped) console.log(`${skipped} could not be attempted.`)
console.log('every file restored.')
process.exit(caught === checked && skipped === 0 ? 0 : 1)
