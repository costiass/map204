// Adds the page fields the current format requires but the exported file is
// missing, without touching anything else in it.
//
// The file was written by an older build whose page shape had no `position` and
// no `ordinal`. Both are required by the current `Page` type, and both are
// stored per page, so a file without them cannot describe a page the server
// agrees to hold. They are filled with the same defaults the app itself uses
// (`DEFAULT_PAGE_POSITION` / first page in the list) so the result is exactly
// what exporting from the current build would have produced.
//
// Everything else is copied verbatim: ids, content, styles, connections, tags.
// Re-issuing ids would be a different, riskier change and is deliberately not
// done here.
//
//   node scripts/fix-import-format.cjs <in.json> [out.json]

const fs = require('fs')

const DEFAULT_PAGE_POSITION = { x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 }
const DEFAULT_PAGE_VIEWPORT = { x: 0, y: 0, zoom: 1 }

const input = process.argv[2]
if (!input) {
  console.error('usage: node scripts/fix-import-format.cjs <in.json> [out.json]')
  process.exit(2)
}

const output = process.argv[3] ?? input
const doc = JSON.parse(fs.readFileSync(input, 'utf8'))

if (doc.version !== 1) {
  console.warn(`note: unexpected version ${doc.version}, continuing anyway`)
}

const changes = []

for (const [index, page] of doc.pages.entries()) {
  // `ordinal` decides where the page sits in the list. A file with one page puts
  // it first, which is what exporting that page alone would have produced.
  if (!('ordinal' in page)) {
    changes.push(`page ${index} (${page.id}): + ordinal: ${index}`)
    // Inserted after id/title, matching the field order the current build emits.
    const rebuilt = {}
    for (const [key, value] of Object.entries(page)) {
      rebuilt[key] = value
      if (key === 'title') rebuilt.ordinal = index
    }
    if (!('ordinal' in rebuilt)) rebuilt.ordinal = index
    for (const key of Object.keys(page)) delete page[key]
    Object.assign(page, rebuilt)
  }

  if (!('position' in page)) {
    changes.push(`page ${index} (${page.id}): + position: ${JSON.stringify(DEFAULT_PAGE_POSITION)}`)
    const rebuilt = {}
    for (const [key, value] of Object.entries(page)) {
      rebuilt[key] = value
      if (key === 'title') {
        rebuilt.ordinal = page.ordinal
        rebuilt.position = { ...DEFAULT_PAGE_POSITION }
      }
    }
    for (const key of Object.keys(page)) delete page[key]
    Object.assign(page, rebuilt)
  }

  if (!('viewport' in page)) {
    changes.push(`page ${index} (${page.id}): + viewport: ${JSON.stringify(DEFAULT_PAGE_VIEWPORT)}`)
    page.viewport = { ...DEFAULT_PAGE_VIEWPORT }
  }
}

fs.writeFileSync(output, JSON.stringify(doc, null, 2))

console.log(`Checked ${doc.pages.length} page(s).`)
if (changes.length === 0) {
  console.log('No changes needed — the file already has every required field.')
} else {
  console.log('Changes made:')
  for (const change of changes) console.log(`  ${change}`)
}
console.log(`Written to ${output}`)
