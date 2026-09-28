// Write the cursor SVGs.
//
// `node scripts/gen-cursors.cjs` after changing --cc-brand, or changing a shape
// in cursors.config.cjs. `npm run test:cursors` fails if the files on disk are out
// of date with either, so an un-regenerated cursor is a red test rather than a
// complaint from a user about the colour being wrong.

const fs = require('fs')
const path = require('path')

const { INK, CURSORS, render, root } = require('./cursors.config.cjs')

const dir = path.join(root, 'public', 'cursors')
fs.mkdirSync(dir, { recursive: true })

const written = []
for (const [name, spec] of Object.entries(CURSORS)) {
  fs.writeFileSync(path.join(dir, `${name}.svg`), render(name, spec), 'utf8')
  written.push(`  ${name}.svg  hotspot ${spec.hotspot[0]},${spec.hotspot[1]}`)
}

console.log(`brand ${INK}; wrote ${Object.keys(CURSORS).length} cursors to public/cursors`)
for (const line of written) console.log(line)
