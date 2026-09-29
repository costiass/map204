// The share-email function's CORS, which is invisible until a browser calls it.
//
// Every email failed with:
//
//   Cross-Origin Request Blocked: The Same Origin Policy disallows reading the
//   remote resource at .../send-share-email. (Reason: CORS header
//   'Access-Control-Allow-Origin' missing). Status code: 405.
//
// Two faults, either fatal alone:
//
//   1. The function answered 405 to the `OPTIONS` preflight, because it rejected
//      every method that was not POST. The browser sends a preflight whenever the
//      request is not "simple" -- and `Authorization` plus a JSON content type is
//      exactly that -- so the POST was never sent at all.
//   2. No response carried `Access-Control-Allow-Origin`, so even a successful POST
//      would have been unreadable.
//
// The 405 in the message is the misleading half: it reads like the function refused
// the email, when it never saw one. The share worked; only the notification did not.
//
// ## Why this is a source scan
//
// The function runs on Deno in Supabase's edge runtime and cannot be run from Node
// without an emulator. What can be checked from here is the shape of the handler,
// which is where both faults were: one method check and one missing header. That is
// weaker than "behaves correctly in a browser", and it is stated rather than
// implied.
//
// What it catches is the realistic regression, which is somebody adding a new early
// return with `Response.json` and forgetting that every response needs headers.

const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'send-share-email')
const fn = path.join(dir, 'index.ts')

let failures = 0
let checked = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

function code(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

if (!fs.existsSync(fn)) {
  console.log(`FAIL  ${fn} is missing.`)
  process.exit(1)
}

const source = code(fn)

/* -- 1. The preflight is answered ------------------------------------------- */

{
  checked += 1
  const serve = source.indexOf('Deno.serve(')
  if (serve < 0) {
    fail('Deno.serve is gone. This file cannot see how the function answers a request.')
  } else {
    const handler = source.slice(serve)
    // The order matters as much as the presence: a preflight carries no
    // Authorization header, so the auth check below would refuse it.
    const optionsAt = handler.indexOf("'OPTIONS'")
    const authAt = handler.indexOf("Bearer ")

    if (optionsAt < 0) {
      fail(
        'the function does not answer an OPTIONS preflight. A browser sends one ' +
          'whenever a request carries an Authorization header or a JSON content ' +
          'type -- which this one always does -- so the POST never leaves the page ' +
          'and every email fails with a CORS error naming neither cause nor function.',
      )
    } else if (authAt >= 0 && authAt < optionsAt) {
      fail(
        'the auth check runs before the OPTIONS preflight is answered. A preflight ' +
          'has no Authorization header by definition, so it would be refused as ' +
          'unauthenticated.',
      )
    } else if (!/respond\(request,\s*null,\s*204\)/.test(handler)) {
      fail('the OPTIONS branch does not answer 204.')
    }
  }
}

/* -- 2. Every response carries the CORS headers ----------------------------- */

{
  checked += 1

  /*
   * The helper is the only place a `Response` may be constructed.
   *
   * Found by locating the helper's own declaration and everything after it, rather
   * than by looking backwards from each `new Response` for the word "function" --
   * a window is a guess, and the first version of this flagged the helper itself
   * because the signature above it was longer than the window. A check that fails on
   * correct code is a check that gets deleted.
   */
  const helperAt = source.indexOf('function respond(')
  const helper = helperAt < 0 ? '' : source.slice(helperAt, source.indexOf('\n}', helperAt))
  const handler = source.slice(helperAt < 0 ? 0 : source.indexOf('}', helperAt))

  const direct = [...handler.matchAll(/new Response\(/g)]
  if (direct.length > 0) {
    fail(
      `${direct.length} response(s) outside the CORS helper are constructed with ` +
        '`new Response`, so they carry no Access-Control-Allow-Origin and the browser ' +
        'cannot read them. Every path out of this function must go through respond().',
    )
  }

  const raw = [...handler.matchAll(/return\s+(?:Response\.json)\b/g)]
  if (raw.length > 0) {
    fail(
      `${raw.length} response(s) are returned with Response.json, which sets no CORS ` +
        'headers. Every path out of this function must add them, including the error ' +
        'paths -- an error the browser cannot read is indistinguishable from the ' +
        'function being down.',
    )
  }

  if (!/return\s+respond\(/.test(handler)) {
    fail('the handler never returns through the CORS helper.')
  }
}

/* -- 3. The allow-list is an allow-list ------------------------------------- */

{
  checked += 1

  /*
   * `Access-Control-Allow-Origin: origin` -- echoing the request's origin -- is the
   * correct pattern *only* when the origin has been checked first, so what is
   * asserted is the check and the echo together rather than the echo alone.
   *
   * The first version of this failed the correct code, because it read an
   * allow-listed echo exactly like an open one. What it should have asked is "is
   * there a list, and is the header derived from it?" -- and the answer is yes.
   */
  if (!/Access-Control-Allow-Origin/.test(source)) {
    fail('no Access-Control-Allow-Origin header is set anywhere.')
  }

  if (/['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(source)) {
    fail(
      'Access-Control-Allow-Origin is `*`. This function sends mail: anybody who can ' +
        'make it send can put mail in any inbox.',
    )
  }

  if (!/ALLOWED_ORIGINS\s*\.includes\(/.test(source)) {
    fail(
      'the Origin is not checked against a list. Echoing it without checking allows ' +
        'every site on the internet to use this function.',
    )
  }

  if (!/ALLOWED_ORIGINS\s*=\s*\[/.test(source)) {
    fail('there is no allow-list of origins to check against.')
  }

  // `Vary: Origin`, unquoted key -- a shared cache serving one origin's response to
  // another turns the allow-list into a suggestion.
  if (!/(?:['"]Vary['"]|Vary)\s*:\s*['"]Origin['"]/.test(source)) {
    fail(
      "no 'Vary: Origin'. Without it a shared cache can serve one origin's response " +
        'to another, which turns the allow-list into a suggestion.',
    )
  }
}

/* -- 4. The function still checks who is asking ----------------------------- */

{
  checked += 1
  const serve = source.indexOf('Deno.serve(')
  const handler = source.slice(serve)

  const checks = [
    { what: 'the bearer token', pattern: /Authorization[\s\S]{0,80}Bearer / },
    { what: 'that the token resolves to a user', pattern: /auth\.getUser\(\)/ },
    { what: 'that the caller owns the workspace', pattern: /owner_id\s*===\s*me\.id/ },
    { what: 'that a collaborator may share', pattern: /document_collaborators/ },
    { what: 'that a viewer may not', pattern: /canShare/ },
  ]

  for (const check of checks) {
    if (!check.pattern.test(handler)) {
      fail(
        `the function no longer verifies ${check.what}. It is a function that sends ` +
          'mail on request, so each of these is the difference between an ' +
          'invitation and an open relay.',
      )
    }
  }
}

/* -- 5. The template is a file, and is reachable ---------------------------- */

{
  checked += 1
  const template = path.join(dir, 'email-template.ts')
  if (!fs.existsSync(template)) {
    fail(
      'there is no email-template.ts. The words somebody will want to change were ' +
        'inside the authorisation boundary, where nobody looks for them.',
    )
  } else {
    /*
     * The *import*, not the name.
     *
     * Checking that `renderEmail` appears somewhere in index.ts passes when
     * index.ts declares its own local `function renderEmail() { return '' }` -- so
     * the template file can be sitting right there, unused, and the check approves.
     * That is precisely the state the extraction was meant to prevent.
     */
    if (!/from '\.\/email-template\.ts'/.test(source)) {
      fail(
        'index.ts does not import from ./email-template.ts. The template is either ' +
          'inlined again or the file is unused, and the words somebody will want to ' +
          'change are back inside the authorisation boundary.',
      )
    }
    /*
     * Every *identifier* must be escaped.
     *
     * A workspace title, a sharer's name and the recipient's address all end up in
     * somebody's inbox, and all three are attacker-influenced in one sense or
     * another -- a workspace title is whatever somebody typed.
     *
     * A *conditional* over already-escaped fragments is not a finding, and the first
     * version of this check flagged seven of them. A bare identifier is the finding;
     * `${hasAccount ? 'a' : 'b'}` is not.
     */
    /*
     * Scoped to `renderEmail`, and only to it.
     *
     * `subjectFor` interpolates the same values into a plain-text subject, where
     * `esc()` would be a *bug* rather than a fix -- a workspace called "A & B"
     * would arrive as "A &amp; B" in the subject line. So the rule is not "escape
     * everything", it is "escape everything that becomes HTML", and the check that
     * says otherwise is what flagged the subject line as a finding.
     */
    const templateSource = code(template)
    const bodyAt = templateSource.indexOf('export function renderEmail')
    if (bodyAt < 0) {
      fail('renderEmail has moved out of email-template.ts, so the escaping below is unchecked.')
    } else {
      const body = templateSource.slice(bodyAt)
      const bare = [...body.matchAll(/\$\{\s*([A-Za-z_][\w.]*)\s*\}/g)].filter(
        (m) => !['hasAccount', 'role'].includes(m[1]),
      )
      if (bare.length > 0) {
        fail(
          `${bare.length} interpolation(s) in renderEmail put a bare value into HTML: ` +
            `${bare.map((m) => '${' + m[1] + '}').join(', ')}. Everything that is not ` +
            "a fixed keyword has to go through esc().",
        )
      }
    }
  }
}

/* -- 6. The deployed configuration lets the preflight through ---------------- */

{
  checked += 1
  const config = path.join(dir, 'config.toml')
  if (!fs.existsSync(config)) {
    fail(
      'there is no config.toml for this function, so the gateway verifies the JWT ' +
        'before the function runs -- and a preflight carries no JWT, so it is ' +
        'answered 401 and the browser never sends the POST.',
    )
  } else if (!/verify_jwt\s*=\s*false/.test(fs.readFileSync(config, 'utf8'))) {
    fail(
      'config.toml does not set verify_jwt = false. The gateway checks the JWT ' +
        'before the function runs, and a CORS preflight has none to check.',
    )
  }
}

if (failures === 0) {
  console.log(
    `share email: ${checked} checks -- the preflight is answered, every response ` +
      'carries CORS, the origin is allow-listed, the authorisation is intact, and ' +
      'the template is a file of its own.',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
