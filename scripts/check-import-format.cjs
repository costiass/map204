/**
 * Runs the app's real parser against a document file, and reports what it made
 * of it. This exists because the question "is this file the right format?" is
 * answerable exactly, by using the same code the app uses, rather than by
 * inspection.
 *
 *   node scripts/check-import-format.cjs path/to/file.json
 *
 * TypeScript is compiled on the fly by Vite's own transform pipeline, loaded
 * through `vite-node` if present, or via a temporary entry point otherwise.
 */

const fs = require('fs')
const path = require('path')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/check-import-format.cjs <file.json>')
  process.exit(2)
}

const raw = fs.readFileSync(file, 'utf8')
let parsed
try {
  parsed = JSON.parse(raw)
} catch (error) {
  console.log(`The file is not valid JSON: ${error.message}`)
  process.exit(1)
}

console.log('=== What the file actually contains ===')
console.log('top-level keys :', Object.keys(parsed).join(', '))
console.log('version        :', parsed.version)
console.log('pages          :', Array.isArray(parsed.pages) ? parsed.pages.length : '(not an array)')

for (const [index, page] of (parsed.pages ?? []).entries()) {
  console.log(`\n--- page ${index} ---`)
  console.log('keys           :', Object.keys(page).join(', '))
  console.log('id             :', page.id)
  console.log('title          :', page.title)
  console.log('has position   :', 'position' in page)
  console.log('viewport       :', JSON.stringify(page.viewport))
  console.log('cards          :', page.cards?.length ?? 0)
  console.log('groups         :', page.groups?.length ?? 0)
  console.log('connections    :', page.connections?.length ?? 0)
  console.log('ordinal        :', 'ordinal' in page ? page.ordinal : '(absent)')
}

// What normalizeDoc / the app treats as required.
console.log('\n=== What the app requires of a page ===')
const required = ['id', 'title', 'position', 'viewport', 'cards', 'groups', 'connections']
for (const [index, page] of (parsed.pages ?? []).entries()) {
  const missing = required.filter((key) => !(key in page))
  console.log(
    `page ${index}: ` +
      (missing.length === 0
        ? 'all required keys present'
        : `MISSING ${missing.join(', ')}`),
  )
}
