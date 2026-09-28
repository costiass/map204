// The cursor artwork, in one place.
//
// Shared by `gen-cursors.cjs` (which writes the files) and `test-cursors.cjs`
// (which checks the files still match). Split out because a cursor's shape and the
// hotspot written in the stylesheet have to agree, and two copies of the hotspot
// table is two chances to disagree.
//
// ## Why PNG, and not SVG
//
// The SVG version of this was correct in every way that can be checked from here:
// the file was served, the content type was right, the intrinsic size was set, the
// stylesheet pointed at it with a matching hotspot, and the built CSS contained the
// rules. And the cursors still did not appear.
//
// Two things were wrong with it, and only one of them is a browser question:
//
//   * Chromium deprecated custom cursors larger than 32x32 DIP that are not fully
//     inside the visual viewport, and cursor-image format support is a long tail of
//     "required for PNG, should for SVG, may for animated SVG". A raster image is
//     the format every browser that supports custom cursors at all supports, with
//     no conditions attached. So the shipped file is a PNG.
//   * The artwork was a 2px stroke in the brand colour behind a 4.5px white halo.
//     On a white card that is a faint indigo outline -- present, technically
//     visible, and not something anybody would describe as "working". A cursor is
//     read at a glance and has to be solid.
//
// The SVG is still what the shapes are *authored* in, because path data is path
// data; it is rasterized here rather than shipped, so there is one shape and one
// hotspot and no chance of the stylesheet describing a different cursor from the
// one on disk.
//
// ## Hollow hand to grab, solid hand when held
//
// The three hand cursors are the same shape, and the difference between "you can
// pick this up" and "you are picking it up" is whether it is filled in. That is the
// platform convention -- a hollow hand over a draggable thing, a solid one while
// the button is down -- and it is one property rather than two drawings that have
// to be kept in step.
//
// It is also the only version that renders. Lucide's `hand-fist` and `hand-grab`
// were both tried for the dragging state and both fall apart at 32px: a stroked
// halo closes over any enclosed gap narrower than half its width, so their finger
// separations fill with white and the cursor comes out as a pale blob. An outline
// of the open hand has no enclosed regions and survives the treatment.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')

const brand = /--cc-brand:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(css)
if (!brand) {
  console.error('could not find --cc-brand in src/index.css')
  process.exit(1)
}
const INK = brand[1]

/**
 * The largest cursor image browsers will reliably honour: 32x32.
 *
 * MDN notes that Firefox and Chromium restrict cursor images to 128x128 but
 * *recommend* 32x32, and Chromium has deprecated anything larger that is not fully
 * inside the visual viewport -- so an oversized cursor fails at the edge of a
 * screen and nowhere else, which reads as flakiness rather than as a size.
 *
 * Declared separately from `PIXELS` on purpose. A test that checks the rendered
 * image against the generator's own constant checks nothing: bump the constant to
 * 64, regenerate, and the assertion moves with it and still passes. This is the
 * limit, and it does not move because somebody changed a number.
 */
const MAX_CURSOR_PIXELS = 32

/**
 * What we actually render: the limit, because 32 is also what an operating system
 * cursor is at 1x, so this is the size people already read cursors at.
 */
const PIXELS = MAX_CURSOR_PIXELS

/**
 * The shapes are drawn in a 24-unit viewBox, because that is Lucide's grid.
 * Rasterizing to 32 scales them by 4/3, and the hotspot scales with them -- see
 * `hotspotFor`, which is the only place that conversion happens.
 */
const DESIGN = 24

/** Lucide's `hand`, shared by the three hand cursors. */
const HAND = [
  { d: 'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2' },
  { d: 'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2' },
  { d: 'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8' },
  {
    d: 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  },
]

/** The palm outline, which is the path that gets a fill. */
const PALM = 3

const CURSORS = {
  // Hollow hand: over a zone you can drag.
  grab: {
    lucide: 'hand',
    design: [12, 13],
    halo: 4,
    weight: 2.4,
    paths: HAND,
  },

  // Solid hand: while a drag is in progress. Same shape, filled in.
  grabbing: {
    lucide: 'hand',
    design: [12, 13],
    halo: 4,
    weight: 3,
    solid: [PALM],
    paths: HAND,
  },

  // Solid hand at the fingertip: over something a click opens.
  //
  // The hotspot is the tip of the index finger -- the part that presses. Anywhere
  // else and the click lands somewhere other than where the finger is drawn, which
  // feels wrong in a way nobody can name.
  point: {
    lucide: 'hand',
    design: [8, 4],
    halo: 4,
    weight: 3,
    solid: [PALM],
    paths: HAND,
  },

  // The I-beam: over text you can select or type into. Lucide `type`.
  //
  // A stroke rather than a fill, because an I-beam filled solid is a blob. The
  // serifs are what make it read as "text" and not "a line", so they stay thin and
  // the halo does the legibility work. Hotspot dead centre, which for a symmetric
  // I-beam is exactly right.
  text: {
    lucide: 'type',
    design: [12, 12],
    halo: 3.9,
    weight: 2.6,
    paths: [{ d: 'M12 4v16' }, { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' }, { d: 'M9 20h6' }],
  },
}

/**
 * The hotspot in the rasterized image's own pixels.
 *
 * The shapes are authored on Lucide's 24-unit grid and rasterized at 32, so the
 * hotspot scales with everything else. Doing this in one place is the point: a
 * hotspot left at its design value would be 25% off, which is several pixels, and
 * several pixels of cursor error is felt immediately and can never be reported.
 */
function hotspotFor(spec) {
  const scale = PIXELS / DESIGN
  return [Math.round(spec.design[0] * scale), Math.round(spec.design[1] * scale)]
}

/** The SVG the shape is authored in, and rasterized from. Never shipped. */
function renderSvg(name, spec) {
  const all = spec.paths
  const solid = spec.solid ?? []

  const drawn = (fill) =>
    all.map((p, i) => `    <path d="${p.d}" fill="${solid.includes(i) ? fill : 'none'}" />`).join('\n')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIXELS}" height="${PIXELS}"`,
    ` viewBox="0 0 ${DESIGN} ${DESIGN}" fill="none"`,
    ' stroke-linecap="round" stroke-linejoin="round">',
    // Pass 1 -- the white underneath. What makes one drawing legible on a white card
    // and on a dark one, with no second set of artwork.
    //
    // The solid paths are filled as well as stroked, which is what puts a body
    // inside the outline. Stroking alone does not, and a fill here is the only way
    // to get one.
    `  <g stroke="#ffffff" stroke-width="${spec.halo}">`,
    drawn(INK),
    '  </g>',
    // Pass 2 -- the brand on top, a little narrower than the halo so the white shows
    // as a rim rather than as the body. The halo being wider than the brand is the
    // whole mechanism; when they were close in size the cursor came out mostly
    // white and read as "faint" rather than "styled".
    `  <g stroke="${INK}" stroke-width="${spec.weight}">`,
    drawn(INK),
    '  </g>',
    '</svg>',
    '',
  ].join('\n')
}

/** The PNG bytes for one cursor. */
function renderPng(name, spec) {
  // Required lazily, and with a message, because "cannot find module" from deep
  // inside a generator tells nobody that the fix is `npm install`.
  let Resvg
  try {
    ;({ Resvg } = require('@resvg/resvg-js'))
  } catch {
    console.error(
      '@resvg/resvg-js is not installed. The cursors are rasterized from their ' +
        'source shapes rather than drawn as PNGs by hand, so the artwork cannot be ' +
        'edited directly. Run: npm install',
    )
    process.exit(1)
  }

  return new Resvg(renderSvg(name, spec), {
    fitTo: { mode: 'width', value: PIXELS },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng()
}

module.exports = {
  INK,
  CURSORS,
  DESIGN,
  PIXELS,
  MAX_CURSOR_PIXELS,
  hotspotFor,
  renderSvg,
  renderPng,
  root,
}
