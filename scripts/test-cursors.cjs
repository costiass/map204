// The cursors, checked.
//
// Three things can silently rot here, and all three look fine on screen:
//
//   1. The files stop matching their generator, because somebody edited an SVG by
//      hand or changed --cc-brand and forgot to re-run it. The cursors are then
//      the wrong colour, or in a shape nobody intended, and there is no error.
//   2. A stylesheet hotspot drifts from the artwork's. A cursor is a few pixels
//      out, which is felt long before it is noticed and is very hard to report.
//   3. A cursor file is deleted or renamed and the stylesheet keeps pointing at it.
//      The browser falls back to the keyword after the comma, so the site looks
//      like it works and has quietly reverted to system cursors.
//
// Each is checked against the same source of truth the generator reads, so none
// of them can pass by agreeing with another copy of the answer.

const fs = require('fs')
const path = require('path')

const { INK, CURSORS, render, root } = require('./cursors.config.cjs')

const dir = path.join(root, 'public', 'cursors')
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/* -- 1. The files match the generator -------------------------------------- */

for (const [name, spec] of Object.entries(CURSORS)) {
  const file = path.join(dir, `${name}.svg`)
  if (!fs.existsSync(file)) {
    fail(
      `public/cursors/${name}.svg is missing. Run: node scripts/gen-cursors.cjs`,
    )
    continue
  }
  const onDisk = fs.readFileSync(file, 'utf8')
  const expected = render(name, spec)
  if (onDisk !== expected) {
    // Say which, because "the file differs" is not a thing anybody can act on.
    const why = onDisk.includes(INK)
      ? `the shape changed but the file was not regenerated`
      : `the brand colour is no longer ${INK} -- if that is intentional, re-run: node scripts/gen-cursors.cjs`
    fail(`public/cursors/${name}.svg is out of date: ${why}`)
  }
}

/* -- 2 + 3. The stylesheet declares them, with the right hotspots ---------- */

/*
 * The stylesheet holds each cursor once, as a custom property, and the rules use
 * `var(--cc-cursor-*)`. So the declaration is what carries the hotspot:
 *
 *   --cc-cursor-grab: url('/cursors/grab.svg') 12 13, grab;
 *
 * and a property nobody reads is as dead as a file nobody points at -- which is
 * why the "is it used" check below exists rather than being folded into this one.
 */
const DECLARATION =
  /--cc-cursor-([\w-]+)\s*:\s*url\(['"]\/cursors\/([\w-]+)\.svg['"]\)\s*(-?\d+)\s+(-?\d+)\s*,\s*([a-z-]+)\s*;/g

const declared = [...css.matchAll(DECLARATION)]
const rawDeclarations = [...css.matchAll(/--cc-cursor-([\w-]+)\s*:/g)]

if (rawDeclarations.length === 0) {
  fail(
    'no --cc-cursor-* properties in src/index.css. The cursor artwork exists but ' +
      'nothing uses it, so the site is on system cursors.',
  )
}

const declaredNames = new Set()

for (const [, variable, file, x, y, keyword] of declared) {
  // The property name and the file name are the same gesture. If they differ, a
  // rule says "grab" and the browser draws a pointing hand.
  if (variable !== file) {
    fail(
      '--cc-cursor-' +
        variable +
        ' points at ' +
        file +
        '.svg. The property name and the file name are the same gesture; one of ' +
        'them is wrong.',
    )
    continue
  }

  const spec = CURSORS[file]
  if (!spec) {
    fail(
      '--cc-cursor-' +
        variable +
        ' points at ' +
        file +
        '.svg, which gen-cursors.cjs does not produce. Either the file is stale ' +
        'or the name is a typo.',
    )
    continue
  }
  declaredNames.add(file)

  // The hotspot. A cursor a few pixels out is felt long before it is noticed, and
  // is very hard for a user to describe.
  const [hx, hy] = spec.hotspot
  if (Number(x) !== hx || Number(y) !== hy) {
    fail(
      '--cc-cursor-' +
        variable +
        ' points at ' +
        x +
        ',' +
        y +
        ' but ' +
        file +
        ".svg's hotspot is " +
        hx +
        ',' +
        hy +
        '. The pointer would land off the drawn shape.',
    )
  }

  // The keyword fallback. A browser that cannot load the SVG shows this, so it is
  // the whole reason a missing file is survivable rather than a dead site.
  if (!keyword) {
    fail('--cc-cursor-' + variable + ' has no keyword after the comma.')
  }
}

// A --cc-cursor-* the regex above could not parse at all -- a typo, a missing
// comma, a url() with no hotspot -- would otherwise pass silently, because it
// simply would not appear in `declared`.
for (const [, variable] of rawDeclarations) {
  if (!declaredNames.has(variable)) {
    fail(
      '--cc-cursor-' +
        variable +
        ' in src/index.css could not be parsed as url(/cursors/NAME.svg) X Y, ' +
        'keyword;. Check for a missing hotspot or a missing fallback keyword.',
    )
  }
}

/* -- 3. Every declared cursor is actually used ------------------------------- */

// A property that is defined and never read is a cursor nobody sees. This is the
// check that stops the set drifting from what the site does: a new gesture needs
// artwork *and* a rule, and the rule is the half that is easy to forget.
for (const name of Object.keys(CURSORS)) {
  const uses = [...css.matchAll(new RegExp('var\\(--cc-cursor-' + name + '\\)', 'g'))].length
  if (uses === 0) {
    fail(
      '--cc-cursor-' +
        name +
        ' is defined but no rule uses it. Either a rule should, or the cursor is ' +
        'not needed.',
    )
  }
}

if (failures === 0) {
  console.log(
    'cursors: ' +
      Object.keys(CURSORS).length +
      ' generated files match, ' +
      declared.length +
      ' properties in ' +
      INK +
      ', every hotspot agrees and every one is used',
  )
} else {
  console.log('\n' + failures + ' check(s) failed.')
  process.exit(1)
}
