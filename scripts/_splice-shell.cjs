// Replace lines 128..265 (1-based) of ElementNode with the single-shell version.
//
// A fixed range, verified by content immediately above and below, so a moved
// file fails loudly rather than splicing the wrong span — which is what the
// content-search version did, twice: it walked back to the function signature.
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'src', 'components', 'ElementNode.tsx')
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

const FROM = 127 // 0-based: line 128
const TO = 265 // 0-based exclusive: through line 265, the component's closing brace

if (!lines[FROM].includes('/* ---') || !lines[FROM + 1].includes('A flash deck is a different shape')) {
  console.error(`unexpected start: ${JSON.stringify(lines[FROM])} / ${JSON.stringify(lines[FROM + 1])}`)
  process.exit(1)
}
if (lines[TO - 1] !== '}') {
  console.error(`unexpected end: ${JSON.stringify(lines[TO - 1])}`)
  process.exit(1)
}
if (!lines[TO + 1].includes('/* ---')) {
  console.error(`unexpected line after: ${JSON.stringify(lines[TO + 1])}`)
  process.exit(1)
}

const replacement = fs
  .readFileSync(path.join(__dirname, '_shell.txt'), 'utf8')
  .replace(/\n$/, '')
  .split('\n')

const out = [...lines.slice(0, FROM), ...replacement, ...lines.slice(TO)]
fs.writeFileSync(file, out.join('\n'), 'utf8')
console.log(`spliced 128-265: ${lines.length} -> ${out.length} lines`)
