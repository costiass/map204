// No mojibake.
//
// Every character in this repository is a character somebody chose. The ones
// that are not — the three-character run that should be an apostrophe, and the
// two that should be an "e with an acute" — are invisible in a diff, survive a
// code review, and reach a user as a row of diamonds in the middle of a
// sentence.
//
// How they get here is worth writing down, because it is not a mistake anybody
// makes on purpose. A UTF-8 file is read *without* being told it is UTF-8, each
// byte is reinterpreted as a character in the local codepage, and the result is
// written back as UTF-8. Every non-ASCII character in the file is corrupted by
// the same edit that looks like a one-line change.
//
// So the test is here, and it is the same idea as the other build checks: the
// failure is silent, it is only visible once it ships, and a check that only
// looked for exceptions would pass the whole time.
//
// The detection is a round trip rather than a list of bad words, because the bad
// words are a list of symptoms. A run of characters that came from a Windows-1252
// reading of UTF-8 bytes will decode cleanly as UTF-8 when re-encoded to
// Windows-1252; a run of genuine accented letters will not, because their bytes
// are not a valid UTF-8 sequence. That is what tells the two apart, and it needs
// no table to keep up to date.
//
// This file is the one place these sequences are allowed to appear, because
// describing them is its job.

const fs = require('fs')
const path = require('path')

const ROOTS = ['src', 'scripts', 'supabase']
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.md', '.cjs', '.mjs', '.js', '.sql', '.html'])

// Windows-1252 is *not* ISO-8859-1, and the difference is exactly where the
// damage lands. Node's `latin1` is the real Latin-1, so it encodes the euro sign
// as 0xAC where Windows-1252 has 0x80 — and a run containing a euro sign
// round-trips to the wrong bytes and looks like it is not mojibake at all. That
// is how the most common mangling in a codebase full of euro amounts and em
// dashes slips past a check built on `latin1`.
//
// This table is the *only* place the two code pages are described. The character
// class the detector searches with is generated from its keys, because the first
// version of this file wrote the same list twice and the copies drifted — the
// entry that went missing was the tilde in the command symbol, so a corrupted
// "select all" shortcut went unrepaired and the check reported its file clean.
const CP1252_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
])

/**
 * Written as an escape, because a file about encoding is the last place to paste
 * a raw character and hope it survives the next edit.
 */
const escape = (code) => `\\u${code.toString(16).padStart(4, '0')}`

// Only runs of two or more. A correct middle dot, multiplication sign or
// accented letter is a single isolated character; mojibake is always a
// sequence, because a UTF-8 character is at least two bytes.
const FROM_CODEPAGE = ['\\u0080-\\u00ff', ...[...CP1252_HIGH.keys()].map(escape)].join('')
const RUN = new RegExp(`[${FROM_CODEPAGE}]{2,}`, 'g')

/** The Windows-1252 bytes a run of characters would have come from. */
function toWindows1252(run) {
  const bytes = []
  for (const character of run) {
    const code = character.codePointAt(0)
    if (code < 0x100) bytes.push(code)
    else if (CP1252_HIGH.has(code)) bytes.push(CP1252_HIGH.get(code))
    else return null
  }
  return Buffer.from(bytes)
}

/** What this run was meant to say, or `null` if it is not mojibake. */
function repair(run) {
  // The corruption is exactly this: UTF-8 bytes became Windows-1252 characters
  // on the way in. Undoing it is encoding those characters back to Windows-1252
  // bytes and reading those as UTF-8.
  const bytes = toWindows1252(run)
  if (bytes === null) return null
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // If re-encoding gives the same characters, the round trip was a no-op and
    // this run was already ordinary text that happens to be accented.
    if (decoded === run) return null
    return decoded
  } catch {
    return null
  }
}

const SKIP = new Set(['node_modules', 'dist', '.git', 'build'])
const SELF = path.basename(__filename)

function* walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (EXTENSIONS.has(path.extname(entry.name)) && entry.name !== SELF) yield full
  }
}

const FIX = process.argv.includes('--fix')
const failures = []
const fixable = []
let scanned = 0

for (const root of ROOTS) {
  for (const file of walk(root)) {
    scanned += 1
    const original = fs.readFileSync(file, 'utf8')
    const broken = (original.match(RUN) ?? []).filter((run) => repair(run) !== null)
    if (broken.length === 0) continue
    if (FIX) {
      // Only the runs are replaced. The rest of the file — its line endings and
      // every correctly encoded character — is byte-for-byte untouched, so a
      // repair cannot quietly change something that was not broken.
      fs.writeFileSync(file, original.replace(RUN, (run) => repair(run) ?? run), 'utf8')
      console.log(`fixed ${file} (${broken.length})`)
      continue
    }
    fixable.push(file)
    failures.push(`${file}  ${broken.length} corrupted run(s), first should read as ${JSON.stringify(repair(broken[0]))}`)
  }
}

for (const message of failures) console.log(`FAIL  ${message}`)

if (FIX) {
  console.log(
    fixable.length === 0
      ? 'encoding: nothing to repair'
      : `encoding: repaired ${fixable.length} file(s)`,
  )
  process.exit(0)
}

if (failures.length === 0) {
  console.log(`encoding: ${scanned} files, every character is a character somebody chose`)
} else {
  console.log(`\n${failures.length} file(s) with corrupted characters.`)
  console.log('These are UTF-8 bytes that were read and written back as a Windows codepage.')
  console.log('Run `node scripts/test-encoding.cjs --fix` to repair them.')
  process.exit(1)
}
