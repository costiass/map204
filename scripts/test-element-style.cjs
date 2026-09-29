// A style applied to every kind, not just a note.
//
// The bug: ElementNode read
//
//   const noteStyle = element.kind === 'note' ? element.style : DEFAULT_NOTE_STYLE
//
// and the Settings panel is shared by all kinds and offers a colour picker for
// every one of them. So a video, a table, a deck, a PDF and a link each accepted a
// colour, saved it, and then drew the note's default instead. The control worked;
// the thing it controlled did not.
//
// Also covered: a link element, which had `url`, `display` and `show` on its schema
// and no renderer and no inspector at all -- it drew "not implemented yet", and
// there was nothing to click that would change that.
const fs = require('fs')
const path = require('path')

const node = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'ElementNode.tsx'),
  'utf8',
)
const tab = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'ElementInspectorTab.tsx'),
  'utf8',
)
const inspector = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'Inspector.tsx'),
  'utf8',
)

let failures = 0
const fail = (m) => {
  console.log(`FAIL  ${m}`)
  failures += 1
}

// Comments stripped: the explanation of what was wrong names the wrong thing, and a
// scan of raw text would read the explanation as the code.
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
const nodeCode = code(node)
const tabCode = code(tab)

/* 1. Every kind draws its own style ----------------------------------------- */

if (/kind\s*===\s*'note'\s*\?\s*element\.style/.test(nodeCode)) {
  fail(
    "the renderer still reads a non-note's style as the note default, so every colour " +
      'picked for a video, a table, a deck, a PDF or a link is saved and then ignored.',
  )
}

if (!/element\.style\s*\?\?/.test(nodeCode)) {
  fail(
    'the renderer has no fallback for an element with no style at all. That fallback ' +
      'is the one thing the old line was actually for -- the chrome has to look ' +
      'deliberate on a kind that has never been styled.',
  )
}

/* 2. And the shadow flag goes with it --------------------------------------- */

if (/data-shadow=\{[^}]*DEFAULT_NOTE_STYLE/.test(nodeCode)) {
  fail('the drop shadow still comes from the note default rather than the element style.')
}

/* 3. Every style field is actually applied ---------------------------------- */

for (const field of ['backgroundColor', 'accentColor', 'textColor', 'borderColor', 'borderWidth', 'borderRadius', 'shadow']) {
  const inTab = tabCode.includes(`style.${field}`)
  // A field the panel edits but the renderer ignores is the original bug again,
  // wearing a different field's name.
  if (inTab && !nodeCode.includes(field) && field !== 'shadow') {
    fail(
      `the panel edits ${field} and the renderer never reads it, so the control would be ` +
        'accepted and discarded. That is the shape of the original bug.',
    )
  }
}

/* 4. Every kind has an inspector ------------------------------------------- */

{
  // The kinds the schema declares, against the kinds the tab switches on. A kind in
  // the first list and not the second falls through to "not implemented yet", which
  // is what a link did for as long as it existed.
  const schema = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'elements', 'schema.ts'),
    'utf8',
  )

  // Only the element kinds, which are the interfaces that `extends ElementBase`.
  // `kind: 'element' | 'group'` is a connection's *endpoint*, not a kind of thing
  // you can put on a page, and the first version of this swept it up and reported
  // a missing inspector for a thing that cannot have one.
  const kinds = [
    ...new Set(
      [...schema.matchAll(/export interface (\w+Element) extends ElementBase \{[\s\S]*?kind:\s*'(\w+)'/g)].map(
        (m) => m[2],
      ),
    ),
  ]

  const handled = new Set([...code(tab).matchAll(/case\s*'(\w+)'/g)].map((m) => m[1]))
  // A note is handled one level up, by CardContentTab, which is what the Inspector
  // chooses for it. It is not missing; it is somewhere else.
  handled.add('note')

  for (const kind of kinds) {
    if (!handled.has(kind)) {
      fail(
        `a ${kind} element has no inspector, so it falls through to the not-implemented ` +
          'message. Every kind declared in the schema needs a case, or the fields it ' +
          'carries are fields nothing can write.',
      )
    }
  }
}

/* 5. A link draws something ----------------------------------------------- */

if (/not implemented yet/.test(nodeCode)) {
  fail(
    'an element still renders the words "not implemented yet". For a link that meant ' +
      'the element existed, could be inserted, had a schema, and drew a placeholder.',
  )
}

if (!/kind\s*===\s*'link'/.test(nodeCode) || !/safeEmbedUrl/.test(nodeCode)) {
  fail(
    'a link does not render its address. The URL was on the schema and was never ' +
      'drawn, so the element could not be used for the one thing it is.',
  )
}

/* 6. And the settings panel is genuinely shared ---------------------------- */

if (!/<ElementSettingsTab[^>]*element=\{card\}/.test(code(inspector))) {
  fail(
    'the Settings tab is not given every element. It is meant to be shared -- colours, ' +
      'border, shadow, size and layout are not a note business -- and a note-only ' +
      'panel is the reason an element can be uncolourable.',
  )
}

// ...and not gated to one kind on the way in. A panel that is present but only
// mounted for notes is the same absence with more indirection.
if (/tab\s*===\s*'settings'\s*&&\s*card\.kind/.test(code(inspector))) {
  fail(
    'the Settings tab is gated on the element being a note, so every other kind loses ' +
      'colours, border, shadow and layout. That is the reason an element could not be ' +
      'restyled, and it looked fine because notes still worked.',
  )
}

if (failures === 0) {
  console.log(
    'element style: every kind draws its own colours, border, radius and shadow; ' +
      'every kind in the schema has an inspector; and a link renders its address ' +
      'instead of a placeholder.',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
