// The cursors, checked.
//
// Five things can silently rot here, and all of them look fine on screen:
//
//   1. The PNGs stop matching their generator, because somebody edited one by hand
//      or changed --cc-brand and forgot to re-run it. The cursors are then the
//      wrong colour, and there is no error.
//   2. A stylesheet hotspot drifts from the artwork's. A cursor is a few pixels
//      out, which is felt long before it is noticed and is very hard to report.
//   3. A cursor file is deleted or renamed and the stylesheet keeps pointing at it.
//      The browser falls back to the keyword after the comma, so the site looks
//      like it works and has quietly reverted to system cursors.
//   4. A cursor is larger than the size browsers will honour. Chromium drops custom
//      cursors beyond 32x32 DIP that are not fully inside the viewport, so an
//      over-large cursor fails *at the edge of the screen* and nowhere else --
//      which looks like flakiness rather than a size.
//   5. A cursor is defined and no rule uses it.
//
// Each is checked against the same source of truth the generator reads, so none of
// them can pass by agreeing with another copy of the answer.
//
// The fourth one is here because of how this file came to exist: the cursors were
// shipped as SVG, everything in the stylesheet was correct, the files were served,
// and nothing appeared. Checking the rendered image is the part that was missing.

const fs = require('fs')
const path = require('path')

const {
  INK,
  CURSORS,
  MAX_CURSOR_PIXELS,
  PIXELS,
  hotspotFor,
  renderPng,
  root,
} = require('./cursors.config.cjs')

const dir = path.join(root, 'public', 'cursors')
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/** Width and height, straight out of the PNG's IHDR chunk. */
function pngSize(buffer) {
  if (buffer.length < 24) return null
  const signature = buffer.slice(1, 4).toString('ascii')
  if (signature !== 'PNG') return null
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

/* -- 1 + 4. The files match the generator, and are the right size --------- */

for (const [name, spec] of Object.entries(CURSORS)) {
  const file = path.join(dir, `${name}.png`)
  if (!fs.existsSync(file)) {
    fail(`public/cursors/${name}.png is missing. Run: node scripts/gen-cursors.cjs`)
    continue
  }

  const onDisk = fs.readFileSync(file)
  const expected = renderPng(name, spec)

  if (!onDisk.equals(expected)) {
    // Say which, because "the file differs" is not a thing anybody can act on.
    const why = onDisk.includes(Buffer.from(INK.slice(1), 'hex'))
      ? `the brand colour is no longer ${INK} -- if that is intentional, re-run: node scripts/gen-cursors.cjs`
      : 'the shape changed but the file was not regenerated'
    fail(`public/cursors/${name}.png is out of date: ${why}`)
  }

  const size = pngSize(onDisk)
  if (!size) {
    fail(`public/cursors/${name}.png is not a PNG`)
  } else if (size.width > MAX_CURSOR_PIXELS || size.height > MAX_CURSOR_PIXELS) {
    // Checked against MAX_CURSOR_PIXELS, not against PIXELS. Checking against the
    // generator's own constant checks nothing: bump it to 64, regenerate, and the
    // assertion moves with it and still passes -- which is exactly what the first
    // version of this check did.
    fail(
      `public/cursors/${name}.png is ${size.width}x${size.height}, and browsers ` +
        `only reliably honour cursor images up to ${MAX_CURSOR_PIXELS}. Beyond ` +
        'that Chromium drops the cursor when it is not fully inside the viewport, ' +
        'so it works everywhere except where a cursor is most used. Rasterize at ' +
        `${MAX_CURSOR_PIXELS} or smaller.`,
    )
  }
}

/* -- 2 + 3. The stylesheet points at them, with the right hotspots ---------- */

/*
 * The stylesheet holds each cursor once, as a custom property, and the rules use
 * `var(--cc-cursor-*)`. So the declaration is what carries the hotspot:
 *
 *   --cc-cursor-grab: url('/cursors/grab.png') 16 17, grab;
 */
const DECLARATION =
  /--cc-cursor-([\w-]+)\s*:\s*url\(['"]\/cursors\/([\w-]+)\.(png|svg)['"]\)\s*(-?\d+)\s+(-?\d+)\s*,\s*([a-z-]+)\s*;/g

const declared = [...css.matchAll(DECLARATION)]
const rawDeclarations = [...css.matchAll(/--cc-cursor-([\w-]+)\s*:/g)]

if (rawDeclarations.length === 0) {
  fail(
    'no --cc-cursor-* properties in src/index.css. The cursor artwork exists but ' +
      'nothing uses it, so the site is on system cursors.',
  )
}

const declaredNames = new Set()

for (const [, variable, file, extension, x, y, keyword] of declared) {
  if (variable !== file) {
    fail(
      `--cc-cursor-${variable} points at ${file}.${extension}. The property name ` +
        'and the file name are the same gesture; one of them is wrong.',
    )
    continue
  }

  const spec = CURSORS[file]
  if (!spec) {
    fail(
      `--cc-cursor-${variable} points at ${file}.${extension}, which ` +
        'gen-cursors.cjs does not produce. Either the file is stale or the name is ' +
        'a typo.',
    )
    continue
  }
  declaredNames.add(file)

  // The hotspot. A cursor a few pixels out is felt long before it is noticed, and
  // is very hard for a user to describe.
  const [hx, hy] = hotspotFor(spec)
  if (Number(x) !== hx || Number(y) !== hy) {
    fail(
      `--cc-cursor-${variable} points at ${x},${y} but ${file}.png's hotspot is ` +
        `${hx},${hy}. The pointer would land off the drawn shape.`,
    )
  }

  // The keyword fallback. A browser that cannot load the image shows this, so it
  // is the whole reason a missing file is survivable rather than a dead site.
  if (!keyword) {
    fail(`--cc-cursor-${variable} has no keyword after the comma.`)
  }

  // The format. SVG cursors are a support question and this one already went wrong
  // once; the file on disk is a PNG, so a stylesheet still asking for the SVG is
  // asking for a file that no longer exists.
  if (extension !== 'png') {
    fail(
      `--cc-cursor-${variable} asks for ${file}.${extension}, but the generator ` +
        'writes PNG. Browsers only reliably honour raster cursor images.',
    )
  }
}

// A --cc-cursor-* the regex above could not parse at all -- a typo, a missing
// comma, a url() with no hotspot -- would otherwise pass silently, because it
// simply would not appear in `declared`.
for (const [, variable] of rawDeclarations) {
  if (!declaredNames.has(variable)) {
    fail(
      `--cc-cursor-${variable} in src/index.css could not be parsed as ` +
        'url(/cursors/NAME.png) X Y, keyword;. Check for a missing hotspot or a ' +
        'missing fallback keyword.',
    )
  }
}

/* -- 5. Every declared cursor is actually used ------------------------------ */

// A property that is defined and never read is a cursor nobody sees.
for (const name of Object.keys(CURSORS)) {
  const uses = [...css.matchAll(new RegExp('var\\(--cc-cursor-' + name + '\\)', 'g'))].length
  if (uses === 0) {
    fail(
      `--cc-cursor-${name} is defined but no rule uses it. Either a rule should, ` +
        'or the cursor is not needed.',
    )
  }
}

/* -- and no stale SVG is left on disk --------------------------------------- */

// The generator removes them, but a file restored from a branch or a merge would
// sit there looking like part of the design and pointing at nothing.
if (fs.existsSync(dir)) {
  for (const stale of fs.readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    fail(
      `public/cursors/${stale} is left over from when the cursors were SVG. ` +
        'Nothing references it and it cannot be shipped as a cursor. Run: ' +
        'node scripts/gen-cursors.cjs',
    )
  }
}

if (failures === 0) {
  console.log(
    `cursors: ${Object.keys(CURSORS).length} PNGs at ${PIXELS}x${PIXELS} match the ` +
      `generator, ${declared.length} properties in ${INK}, every hotspot agrees, ` +
      'every one is used',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
