// Write the cursor PNGs.
//
// `node scripts/gen-cursors.cjs` after changing --cc-brand, or changing a shape in
// cursors.config.cjs. `npm run test:cursors` fails if the files on disk are out of
// date with either, so an un-regenerated cursor is a red test rather than a
// complaint from a user about the cursor being invisible.

const fs = require('fs')
const path = require('path')

const { CURSORS, PIXELS, hotspotFor, renderPng, root } = require('./cursors.config.cjs')

const dir = path.join(root, 'public', 'cursors')
fs.mkdirSync(dir, { recursive: true })

// The old SVG files are not shipped any more -- see the note at the top of
// cursors.config.cjs for why the format changed. Left on disk they would be
// dead weight that looks load-bearing, so they go.
for (const stale of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.svg')) : []) {
  fs.rmSync(path.join(dir, stale))
  console.log(`removed public/cursors/${stale} -- cursors are PNG now`)
}

const written = []
for (const [name, spec] of Object.entries(CURSORS)) {
  fs.writeFileSync(path.join(dir, `${name}.png`), renderPng(name, spec))
  const [hx, hy] = hotspotFor(spec)
  written.push(`  ${name}.png  ${PIXELS}x${PIXELS}  hotspot ${hx},${hy}`)
}

console.log(`wrote ${Object.keys(CURSORS).length} cursors to public/cursors`)
for (const line of written) console.log(line)
