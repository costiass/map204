// The element's chrome, agreed on in two places.
//
// A title bar's height is needed by both the stylesheet and the model, and they
// are two different files that cannot see each other:
//
//   src/index.css              --cc-header-height: 38px, which is what renders
//   src/elements/defaults.ts   ELEMENT_HEADER_HEIGHT = 38, which the model uses
//
// The model needs it because an element's `height` covers the title bar *and* the
// body. Anything that sizes itself from an aspect -- a video, above all -- adds
// the bar, and gets it exactly right only if the bar is a number it knows.
//
// Which means a fixed header and a stale constant would put back the same
// off-by-thirty, with a test that passes: every video is sized correctly for the
// header that was in the stylesheet last Tuesday. So the two are compared here,
// and this fails the moment either moves without the other.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const css = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')
const defaults = fs.readFileSync(path.join(root, 'src', 'elements', 'defaults.ts'), 'utf8')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/* -- the stylesheet ------------------------------------------------------- */

const cssValue = /--cc-header-height:\s*(\d+(?:\.\d+)?)px\s*;/.exec(css)
if (!cssValue) {
  fail(
    'src/index.css has no --cc-header-height. The title bar has to have a height ' +
      'the model can use, so it has to be a number and not a side effect of ' +
      'padding and font metrics.',
  )
} else if (!/\.cc-card__header\s*\{[^}]*height:\s*var\(--cc-header-height\)/s.test(css)) {
  fail(
    '--cc-header-height is defined but .cc-card__header does not use it. The ' +
      'constant would be right and the bar would be some other height.',
  )
}

/* -- the model ------------------------------------------------------------ */

const tsValue = /ELEMENT_HEADER_HEIGHT\s*=\s*(\d+(?:\.\d+)?)/.exec(defaults)
if (!tsValue) {
  fail('src/elements/defaults.ts has no ELEMENT_HEADER_HEIGHT.')
}

/* -- and they agree ------------------------------------------------------- */

if (cssValue && tsValue) {
  const cssPx = Number(cssValue[1])
  const tsPx = Number(tsValue[1])
  if (cssPx !== tsPx) {
    fail(
      `the title bar is ${cssPx}px in src/index.css and ${tsPx}px in ` +
        'ELEMENT_HEADER_HEIGHT. A video element sizes its height by adding that ' +
        'number to the aspect arithmetic, so the two cannot differ: every video ' +
        'would be off by the difference, and the number in the model would not ' +
        'be the number on screen.',
    )
  }

  /*
   * And the bar has to leave room for the content in it.
   *
   * A fixed height with buttons in it means the buttons get clipped if the bar is
   * too short. `.cc-card__btn` is 1.5rem square and the bar has no vertical
   * padding any more, so it cannot be less than that.
   */
  const button = /\.cc-card__btn\s*\{[^}]*height:\s*([\d.]+)rem/s.exec(css)
  if (button) {
    const buttonPx = Number(button[1]) * 16
    if (cssPx < buttonPx) {
      fail(
        `--cc-header-height is ${cssPx}px but the buttons in the bar are ` +
          `${buttonPx}px tall, so they are clipped.`,
      )
    }
  }
}

if (failures === 0) {
  console.log(
    `element chrome: the title bar is ${cssValue ? cssValue[1] : '?'}px in the ` +
      'stylesheet and in the model',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
