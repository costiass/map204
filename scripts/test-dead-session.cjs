// Prove the app recognises a session the project has stopped accepting, and
// clears it.
//
// The state this is about was found by taking a token out of a browser log and
// asking the project about it, in three places:
//
//   GET  /auth/v1/user      403  bad_jwt  invalid JWT: ... signature is invalid
//   GET  /rest/v1/documents 401  PGRST301 None of the keys was able to decode the JWT
//   POST /functions/v1/...  401  {"error":"Not signed in."}
//
// The same token, refused by every part of the project at once, while the browser
// believed it was signed in -- because `exp` was hours away and `autoRefreshToken`
// had no reason to replace it. The signing key had rotated and the token was
// orphaned.
//
// None of those is a 23503, so the existing check for "the account was deleted"
// did not fire, and the app kept retrying with a token that could never work.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let failures = 0
let checked = 0
const fail = (m) => {
  console.log(`FAIL  ${m}`)
  failures += 1
}

const lib = read('src/lib/supabase.ts')
const writer = read('src/store/writeErrors.ts')
const sync = read('src/store/supabase-sync.ts')

/* 1. The three refusals the project actually produces are recognised ---------- */

checked += 1
{
  // Stripped of comments first, deliberately.
  //
  // A presence check on `PGRST301` passes on a file that only *mentions* it in a
  // comment explaining why it matters, which is exactly what the comment above
  // `isDeadToken` does. The first version of this test had that bug and the
  // corresponding break sailed through it: the code was disabled, the comment
  // remained, and the check reported the code as present.
  //
  // So the assertion is on the *expression* -- a comparison against the quoted
  // code -- which appears in code and not in prose.
  const libCode = lib.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  const cases = [
    ["'PGRST301'", 'the REST API, when no signing key matches the token'],
    ['bad_jwt', 'the auth API, for a signature it cannot verify'],
  ]

  for (const [code, where] of cases) {
    if (!libCode.includes(code)) {
      fail(
        `a dead token is not recognised by its error code: ${code} is missing from the ` +
          `code, which is what ${where} answers. The app will keep using a session the ` +
          'project refuses.',
      )
    }
  }

  // And the message form, for the responses that carry no usable code.
  if (!libCode.includes('token signature is invalid')) {
    fail(
      'the dead-token check does not match the message Supabase sends for an ' +
        'unverifiable signature. That message arrives with a variety of codes, so ' +
        'matching on the code alone misses it.',
    )
  }
}

/* 2. 42501 is not mistaken for a dead token ---------------------------------- */

checked += 1
if (!/42501/.test(lib)) {
  fail(
    'the dead-token check does not exclude 42501. That is Postgres naming a row-level ' +
      'security refusal, which happens every time a viewer opens a page -- clearing the ' +
      "session on it would sign every read-only guest out of a map they are entitled to see.",
  )
}

/* 3. The session is actually cleared ----------------------------------------- */

checked += 1
{
  /*
   * Inside the dead-token branch, not anywhere in the file.
   *
   * `handleWriteError` already signs out for the 23503 case, so a whole-file search
   * for `auth.signOut()` finds that one and approves a dead-token branch that only
   * pushes a toast. The break that proved it removed the sign-out from exactly that
   * branch and the test reported success.
   *
   * So the branch is taken out of the file first and the sign-out is looked for in
   * what is left. A branch that recognises the condition and then does not act on it
   * is the failure this is for.
   */
  const branchStart = writer.indexOf('if (isDeadToken(error)) {')
  if (branchStart < 0) {
    fail(
      'there is no dead-token branch in handleWriteError. A session the project refuses ' +
        'is recognised nowhere, so the app keeps sending it.',
    )
  } else {
    // Up to the next top-level `if`, which is the end of this branch.
    const nextBranch = writer.indexOf('\n  if (', branchStart + 10)
    const branch = writer.slice(branchStart, nextBranch < 0 ? undefined : nextBranch)

    if (!/auth\.signOut\(\)/.test(branch)) {
      fail(
        'a dead token is recognised but the session is never cleared. The app would keep ' +
          'sending a token that cannot work, and the user would see the same failure on ' +
          'every retry with no way out but clearing site data by hand.',
      )
    }
  }
}

/* 4. The share path, which is where it was noticed ---------------------------- */

checked += 1
{
  // `notifyShare` talks to an edge function over `fetch`, not through the REST
  // client, so it never reaches the shared write-error handler on its own. Without
  // this the share dialog is the one place that keeps failing after the rest of the
  // app has recovered.
  if (!/response\.status\s*===\s*401/.test(sync)) {
    fail(
      'the share notification does not look at the 401 status. It goes through fetch ' +
        'rather than the REST client, so the shared handler never sees it, and the ' +
        'dialog is left reporting a failure that no amount of retrying will fix.',
    )
  }

  if (!/handleWriteError/.test(sync.split('export async function notifyShare')[1] ?? '')) {
    fail(
      'the share notification does not route a dead session through handleWriteError, ' +
        'so the session is not cleared when sharing is what revealed it.',
    )
  }
}

/* 5. And the user is told the truth ----------------------------------------- */

checked += 1
if (!/session has expired/i.test(writer) || !/Sign in again/i.test(writer)) {
  fail(
    'the dead-token path does not say the session has expired and that signing in ' +
      'again is the fix. Without that, the message is indistinguishable from the ' +
      'account having been removed, which is a different problem with no fix.',
  )
}

if (failures === 0) {
  console.log(
    `dead session: ${checked} checks -- a token the project refuses is recognised, the ` +
      'session is cleared, the share path is covered, and the user is told that signing ' +
      'in again is the fix.',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
