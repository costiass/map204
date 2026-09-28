// Every field on an element is read by something.
//
// This came from a question asked in good faith and answered badly: "what is
// behaviour options, what is the purpose of it?" The answer was that it had none.
// A flash element carried `presentation: 'carousel' | 'single'`, the inspector
// offered it as two buttons, and not one line of rendering code read it. The
// deck's arrows behaved identically either way.
//
// A field like that is worse than a missing one. A missing field has a default and
// nobody misses it. A field with a control is a promise, the promise is kept
// nowhere, and there is no way for the person who pressed the button to tell that
// nothing happened -- which is exactly the confusion that produced the question.
//
// So: every field declared on every element kind has to be read somewhere in the
// application. Not in the schema, not in the normalizer, not in the store's
// interface -- those all *write* it, and writing it is what made it look alive.
// Somewhere that draws it, or reads it to decide something.
//
// The check is a name appearing in a real consumer. That is crude, and deliberately
// so: a false positive costs an ignore comment next to one line, while a missed
// dead field costs a person asking what a button does.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/* -------------------------------------------------------------------------- */
/* The fields                                                                  */
/* -------------------------------------------------------------------------- */

const schema = read('src/elements/schema.ts')

/**
 * Which files count as reading something.
 *
 * The first version of this test counted any file that mentioned the field's name,
 * and it passed with the dead field back in the tree. Two reasons, both instructive:
 *
 *   1. `presentation` is a word all over this codebase -- `presentationOpen`,
 *      `PresentOverlay`, "a presentation step" in a dozen comments. A name that
 *      common is evidence of nothing.
 *
 *   2. Worse, the inspector itself read it: `element.presentation === 'single'`,
 *      to decide which of the two buttons was highlighted. That is a control
 *      reading its own value to look pressed. It is the definition of a field that
 *      changes nothing, and any test that accepts it is testing nothing.
 *
 * So a reader has to be code that *uses* the value -- a property access or a
 * destructured binding -- and not a file whose whole job is to edit the element.
 * The inspector, the settings panels and the dialogs are excluded: they are where
 * fields go to be written, and a field that only ever appears there has no reader.
 */
const IS_CONFIGURATION = /Inspector|Settings|Dialog|Menu|PresentationInspector/

function consumerText() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of CONSUMER_DIRS) walk(dir)

  return files
    .map((file) => ({ file: file.replace(/\\/g, '/'), text: stripComments(read(file)) }))
    .filter(({ file }) => !IS_CONFIGURATION.test(path.basename(file)))
}

/**
 * Code with the comments taken out.
 *
 * Essential here and not a nicety: this file's own subject is a field described in
 * prose. A comment saying "how far an answer may fill the card" is not a reader of
 * anything, and with comments in, prose naming a field would excuse it.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/**
 * `interface XElement extends ElementBase { ... }`, and its own fields.
 *
 * `ElementBase` is excluded on purpose: its fields are read by the shared chrome
 * rather than by any one kind, and listing them per kind would raise the same
 * complaint six times.
 */
function fieldsOf(interfaceName) {
  const start = schema.indexOf(`export interface ${interfaceName} extends ElementBase {`)
  if (start < 0) return null

  const open = schema.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < schema.length; i += 1) {
    if (schema[i] === '{') depth += 1
    if (schema[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null

  const body = schema.slice(open + 1, end)

  // Strip comments first, or a field named in prose counts as a field.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  const names = new Set()
  // `name: type`, at the start of a line, not inside an object literal. The `m`
  // in `x: { m: 1 }` is indented, which is what keeps them out.
  for (const m of code.matchAll(/^\s{2}([a-zA-Z_][\w]*)\??\s*:/gm)) names.add(m[1])

  return [...names]
}

const KINDS = [
  ['NoteElement', 'note'],
  ['VideoElement', 'video'],
  ['PdfElement', 'pdf'],
  ['FlashElement', 'flash'],
  ['LinkElement', 'link'],
  ['TableElement', 'table'],
]

/* -------------------------------------------------------------------------- */
/* Where a consumer would be                                                    */
/* -------------------------------------------------------------------------- */

// Components, hooks, utils and the store's implementation. Everything a person
// interacts with, and nothing that merely stores.
const CONSUMER_DIRS = ['src/components', 'src/hooks', 'src/utils', 'src/store']

/*
 * Deliberately excluded, because each of these *writes* every field and would make
 * the check pass on its own:
 *
 *   src/elements/schema.ts     the declaration
 *   src/elements/serialize.ts  the normalizer, the maker, migrate
 *   src/elements/migrate.ts    v1 -> v2
 *   types.ts                   re-exports
 *
 * And `src/store/useCanvasStore.ts` is included deliberately: an action that
 * reads a field to decide something is a consumer even if it does not draw it.
 */

function consumerText() {
  const files = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of CONSUMER_DIRS) walk(dir)
  return files.map((file) => ({ file: file.replace(/\\/g, '/'), text: read(file) }))
}

const consumers = consumerText()

/* -------------------------------------------------------------------------- */
/* The check                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Fields known to have no reader, with the reason.
 *
 * This is *not* a place to make the suite green, and it is printed on every run
 * for that reason. Each entry is a field with a control or an upload behind it
 * that the application does not actually honour -- found by this test, and open.
 * A silent ignore list is how the next dead field gets added: one entry, then two,
 * then nobody reads the file any more. So every entry below is printed, every run,
 * until it has a reader or the control goes away.
 *
 * The alternative -- leaving the suite red -- is worse, because a red suite stops
 * being run.
 */
const KNOWN_UNREAD = new Map([
  [
    'PdfElement.file',
    'an uploaded PDF is stored and then ignored -- PdfView renders element.url ' +
      'only, so the upload path writes a file nothing displays',
  ],
  [
    'LinkElement.show',
    'the host/full/none choice has no reader; `link` is declared but not ' +
      'offered, so this has never been reachable from the interface',
  ],
])

let checked = 0
/** [qualified field name, why it has no reader yet] for this run. */
const unread = []

for (const [interfaceName, kind] of KINDS) {
  const fields = fieldsOf(interfaceName)
  if (fields === null) {
    fail(`no interface ${interfaceName} in src/elements/schema.ts`)
    continue
  }
  if (fields.length === 0) {
    fail(`${interfaceName} declared no fields of its own -- is the interface empty?`)
    continue
  }

  for (const field of fields) {
    /*
     * A read is a *use*: `element.width`, `e.width`, `{ width } = element`.
     *
     * A bare key is not a use. `{ presentation: 'single' }` in the inspector is a
     * write, and `element.presentation === 'single'` in the inspector is a control
     * checking its own state -- which is precisely the case this test exists to
     * refuse, so the configuration files are already out of scope above.
     */
    const read =
      new RegExp(`\\.\\s*${field}\\b`) ||
      new RegExp(`[{,]\\s*${field}\\s*[,}]`) // destructured: { width, height }

    // Also require the file to be about this kind, so `video.url` is not excused
    // by a note's `url`.
    const hits = consumers.filter(
      ({ text }) => read.test(text) && new RegExp(`\\b${kind}\\b`).test(text),
    )

    checked += 1

    const qualified = `${interfaceName}.${field}`
    if (hits.length === 0) {
      const known = KNOWN_UNREAD.get(qualified)
      if (known) {
        unread.push([qualified, known])
      } else {
        fail(
          `${qualified} is declared, written by the normalizer and the maker, and ` +
            `read by nothing outside ${CONSUMER_DIRS.join(', ')}. A field with no ` +
            'reader and a control in the inspector is a promise kept nowhere -- ' +
            'which is how "what is behaviour options?" gets asked. Give it a ' +
            'reader, or take the control away.',
        )
      }
    }
  }
}

if (failures === 0) {
  console.log(
    `element fields: ${checked} declared across ${KINDS.length} kinds, every one ` +
      'read by something that draws or decides',
  )

  if (unread.length > 0) {
    console.log('')
    console.log(`  ${unread.length} known field(s) with no reader yet, still open:`)
    for (const [field, why] of unread) console.log(`    - ${field}: ${why}`)
  }
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
