// The URL rules for a card that loads something into an iframe.
//
// This is the security boundary for the whole feature, so it is worth stating
// plainly what it protects against. A card body is Markdown and is sanitised
// before rendering. An embed is not: it becomes the `src` of a live third-party
// document in the reader's own page. So a pasted `javascript:` URL in an
// `<iframe src>` is code execution in somebody's session, and `data:` can carry
// a document that does the same.
//
// Two properties are therefore asserted, and they are different:
//
//   1. nothing unvalidated ever reaches an iframe src
//   2. a YouTube player URL is *built* from an extracted id, so a card that
//      claims to be a video but points elsewhere cannot load that elsewhere
//
// Run the real module, not a copy: a copy would test the copy.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROLDOWN_CLI = 'node_modules/rolldown/bin/cli.mjs'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embeds-'))
const bundle = path.join(dir, 'embeds.mjs')

try {
  execFileSync(
    process.execPath,
    [ROLDOWN_CLI, 'src/utils/embeds.ts', '--format', 'esm', '--file', bundle],
    { stdio: 'pipe' },
  )
} catch (error) {
  console.log(`FAIL  could not bundle src/utils/embeds.ts: ${error.stderr ?? error.message}`)
  process.exit(1)
}

const url = `data:text/javascript;base64,${Buffer.from(fs.readFileSync(bundle)).toString('base64')}`

const script = `
import(${JSON.stringify(url)})
  .then((m) => {
    const cases = []

    // --- URLs that must never be loaded in an iframe -------------------
    //
    // The first group matters most and was added after a check that appeared to
    // pass for the wrong reason: \`javascript:alert(1)\` has an *empty hostname*,
    // so the "has a dot" rule rejects it too, and a test using only those can
    // pass with the protocol allowlist deleted. These carry a plausible hostname
    // so that only the protocol check can reject them.
    const hostile = [
      'javascript://example.com/alert(1)',
      'javascript://a.b/c',
      'vbscript://example.com/x',
      'javascript:alert(1)',
      'JavaScript:alert(document.cookie)',
      '  javascript:alert(1)  ',
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'about:blank',
      'blob:https://example.com/abc',
      '',
      '   ',
      'not a url at all',
    ]
    for (const value of hostile) {
      const result = m.safeEmbedUrl(value)
      if (result !== null) {
        cases.push(\`safeEmbedUrl(\${JSON.stringify(value)}) returned \${JSON.stringify(result)}\`)
      }
    }

    // --- URLs that are fine --------------------------------------------
    const fine = [
      'https://example.com/a.pdf',
      'http://example.com/a.pdf',
      'https://sub.domain.example.co.uk/deep/path.pdf?x=1#page=2',
      'example.com/a.pdf',
    ]
    for (const value of fine) {
      const result = m.safeEmbedUrl(value)
      if (result === null) {
        cases.push(\`safeEmbedUrl(\${JSON.stringify(value)}) was rejected\`)
      } else if (!/^https?:/.test(result)) {
        cases.push(\`safeEmbedUrl(\${JSON.stringify(value)}) returned a non-http scheme\`)
      }
    }

    // --- YouTube id extraction, across the shapes a paste arrives in ---
    const id = 'dQw4w9WgXcQ'
    const withId = [
      \`https://www.youtube.com/watch?v=\${id}\`,
      \`https://youtube.com/watch?v=\${id}&t=90s\`,
      \`https://m.youtube.com/watch?v=\${id}\`,
      \`https://youtu.be/\${id}\`,
      \`https://youtu.be/\${id}?t=90\`,
      \`https://www.youtube.com/embed/\${id}\`,
      \`https://www.youtube.com/shorts/\${id}\`,
      \`https://www.youtube.com/live/\${id}\`,
      id,
    ]
    for (const value of withId) {
      if (m.youtubeVideoId(value) !== id) {
        cases.push(\`youtubeVideoId(\${JSON.stringify(value)}) did not find the id\`)
      }
    }

    // --- and the shapes that are not YouTube ---------------------------
    const withoutId = [
      'https://vimeo.com/12345',
      'https://example.com/watch?v=abc',
      'https://www.youtube.com/watch?v=tooshort',
      'https://www.youtube.com/watch?v=waaaaaaaaytoolong',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      '',
    ]
    for (const value of withoutId) {
      if (m.youtubeVideoId(value) !== null) {
        cases.push(\`youtubeVideoId(\${JSON.stringify(value)}) invented a video id\`)
      }
    }

    // --- a player URL is built from the id, never taken from the card ---
    // A card that says "youtube" but points at another host must not produce a
    // player URL for that host.
    for (const value of withoutId.filter((v) => v.includes('evil') || v.includes('notyoutube'))) {
      if (m.youtubeEmbedUrl(value) !== null) {
        cases.push(\`youtubeEmbedUrl(\${JSON.stringify(value)}) produced a player URL\`)
      }
    }
    const player = m.youtubeEmbedUrl(\`https://youtu.be/\${id}\`)
    if (player === null || !player.includes('youtube-nocookie.com/embed/' + id)) {
      cases.push(\`youtubeEmbedUrl did not build a player from the id: \${player}\`)
    }

    // A timestamp in the link should survive into the player.
    const timed = m.youtubeEmbedUrl(\`https://youtu.be/\${id}?t=90\`)
    if (timed === null || !timed.includes('start=90')) {
      cases.push(\`a t=90 link lost its timestamp: \${timed}\`)
    }

    // --- kind inference -------------------------------------------------
    //
    // The kind-inference helpers are gone. In v1 this file decided what kind a
    // pasted URL should be, which was a fourth copy of the list of kinds. In v2
    // the kinds live in \`elements/registry\` and the URL rules stay here, so
    // what is worth asserting is the rule rather than the guess: a YouTube link
    // yields a video id, and anything else yields nothing. Whether that becomes
    // a video element or a note is \`normalizeElement\`'s decision, and it is
    // tested there.
    if (m.youtubeVideoId(\`https://youtu.be/\${id}\`) !== id) {
      cases.push('a YouTube link did not yield its id')
    }
    if (m.youtubeVideoId('https://example.com/not-a-video') !== null) {
      cases.push('a non-YouTube link produced a video id')
    }
    if (m.looksLikePdf('https://example.com/notes.pdf') !== true) {
      cases.push('a .pdf link was not recognised')
    }
    if (m.looksLikePdf('https://example.com/page') !== false) {
      cases.push('a plain link was treated as a PDF')
    }

    process.stdout.write(JSON.stringify(cases))
  })
  .catch((e) => { console.error(String(e)); process.exit(3) })
`

let failures = []
try {
  const output = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  failures = JSON.parse(output)
} catch (error) {
  console.log(`FAIL  the checks could not run: ${error.stderr ?? error.message}`)
  process.exit(1)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}

for (const message of failures) console.log(`FAIL  ${message}`)

if (failures.length === 0) {
  console.log(
    'embeds: hostile URLs refused, YouTube ids found in every shape, player URLs built from the id',
  )
} else {
  console.log(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
