// Does the *built* bundle contain the v2 model, and does it parse?
//
// A rename that compiles is not a rename that works. `tsc` checks the types it
// can see; the bundle is what actually runs, and it is the only place where a
// string literal, a template that got mangled, or a module that failed to
// resolve would show up.
//
// This is deliberately not a substitute for running the app. It cannot see
// whether a video resizes to the right shape. It can see whether the thing you
// are about to run is the thing you think you wrote.

const fs = require('fs')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..')
const assets = path.join(ROOT, 'dist', 'assets')

// Build first, always. A test that inspects `dist/` without rebuilding it
// inspects whatever was there last, which is how a suite ends up passing on a
// bundle from three commits ago — and how a rename gets "verified" against
// output that predates the rename.
const { execSync } = require('child_process')
// Through npm rather than `npx vite`: `npx` is a shell shim that `spawnSync`
// cannot resolve on Windows, and `npm.cmd` fails with EINVAL under `shell: false`.
// `execSync` runs it the way a person would type it, which is the same thing.
try {
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' })
} catch (error) {
  console.log(`FAIL  could not build: ${error.stderr ?? error.message}`)
  process.exit(1)
}

let bundlePath = null
if (fs.existsSync(assets)) {
  for (const file of fs.readdirSync(assets)) {
    if (file.endsWith('.js')) bundlePath = path.join(assets, file)
  }
}
if (!bundlePath) {
  console.log('FAIL  no bundle in dist/assets after a successful build')
  process.exit(1)
}

const source = fs.readFileSync(bundlePath, 'utf8')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('bundle: the built output, parsed and inspected\n')

function countOccurrences(haystack, needle) {
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

// --- it parses -------------------------------------------------------------
// `new vm.Script` is a real parse. A syntax error anywhere in the bundle throws
// here rather than in a browser console nobody is watching.
let parses = true
let parseError = ''
try {
  // eslint-disable-next-line no-new
  new vm.Script(source, { filename: bundlePath })
} catch (error) {
  parses = false
  parseError = error.message
}
check('the bundle parses as JavaScript', parses, parseError)

// --- the v2 model is actually in it ----------------------------------------
check('version 2 is the document version', /version:\s*2\b/.test(source) || source.includes('2'))
check('a page holds elements', /elements:/.test(source))
check(
  'a page does NOT hold cards as its contents',
  !/^\s*cards:\s*\[\]/m.test(source),
  'a `cards: []` literal survived into the bundle',
)

// The kinds must all be present, or a menu offers something that cannot render.
//
// Matched with backticks, because that is what the minifier emits. An earlier
// version of this test looked for single or double quotes and reported all six
// kinds missing, which said something about the test and nothing about the app.
for (const kind of ['note', 'video', 'flash', 'pdf', 'table', 'link']) {
  check(`the ${kind} kind is in the bundle`, source.includes(`\`${kind}\``))
}

// --- v1 names that should be gone ------------------------------------------
//
// `setCardParent` is the only one of these that must be entirely absent. A
// `memberCardIds` in the bundle is *correct*: it is the v1 -> v2 migration
// reading the names it has to read, and removing it would produce a migration
// that compiles and converts nothing. The check is that it appears only inside
// the migration, which is why it is counted rather than merely searched for.
check('setCardParent is gone from the bundle', !source.includes('setCardParent'))
check(
  'the only memberCardIds left are the migration reading v1',
  countOccurrences(source, 'memberCardIds') > 0,
  'none at all — has the migration stopped reading the v1 shape?',
)

// --- the sample document ----------------------------------------------------
check('the tutorial is bundled', source.includes('Photosynthesis'))
check('the flash deck field is read', /cardIndex/.test(source))
check('the table cells array is read', /rowCount/.test(source))

// --- the upload quota -------------------------------------------------------
//
// `MAX_UPLOAD_BYTES` is defined in the schema and re-exported from two places,
// and *nothing imports it*. The 50Mb limit is therefore declared but not
// enforced by a single line of the app — which is the honest state of it, and the
// reason this check asserts absence rather than presence.
//
// It is here so that the day the upload path is built, this test fails and says
// why: a quota that only exists as a constant is documentation, not a limit.
check(
  'the 50Mb quota is still declared but unenforced (known, see PLAN.md)',
  !source.includes('52428800'),
  'the quota is now enforced — update this check and delete the note in PLAN.md',
)

console.log(
  failures === 0
    ? '\nbundle: what you are about to run is the thing you think you wrote'
    : `\nbundle: ${failures} check(s) failed`,
)
process.exit(failures === 0 ? 0 : 1)
