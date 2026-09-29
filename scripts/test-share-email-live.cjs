// Run the share-email function for real and make real requests at it.
//
// `test-share-email-cors.cjs` reads the source. That is evidence, not proof: it
// cannot tell whether the browser will let anybody read the response, because that
// depends on the headers that actually leave the process.
//
// Supabase's edge runtime is a Deno server with the same request handling as the
// hosted one, and the image is already on this machine -- so this starts it with the
// functions mounted and asks it the questions a browser asks:
//
//   OPTIONS, with an Origin                    -> 204, with Access-Control-Allow-Origin
//   OPTIONS, with an Origin nobody allows      -> 204, with *no* allow-origin
//   POST,   with an Origin and no token        -> 401, readable by that origin
//   POST,   from a disallowed origin           -> 401, unreadable
//
// The last two are the ones that matter and the ones a source scan is weakest on:
// an error the browser cannot read is indistinguishable from the function being
// down, which is exactly how a CORS bug hides behind a working share.
//
// Skips where Docker or the image is absent: a test that cannot run must not be a
// red test, or it gets deleted.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const CONTAINER = 'map204-edge-test'
const IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.76.2'
const PORT = 8099
const ROOT = path.join(__dirname, '..')

let failures = 0
let checked = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}
const skip = (message) => {
  console.log(`SKIP  ${message}`)
  process.exit(0)
}

/* -- is this runnable here? ------------------------------------------------- */

try {
  execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { stdio: 'ignore' })
} catch {
  skip('Docker is not available, so the edge function cannot be exercised.')
}
try {
  execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' })
} catch {
  skip(`the edge runtime image ${IMAGE} is not present locally, and this will not pull it.`)
}

/* -- start it --------------------------------------------------------------- */

const cleanup = () => {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  } catch {
    /* not running */
  }
}
process.on('exit', cleanup)

;(async () => {
  cleanup()
  execFileSync(
    'docker',
    [
      'run', '-d', '--name', CONTAINER,
      '-p', `${PORT}:9000`,
      // The functions directory, which is where the runtime looks for them.
      '-v',
    `${path.join(ROOT, 'supabase', 'functions', 'send-share-email')}:/home/deno/main:ro`,
      // Enough configuration for the function to import and start. It reaches for a
      // database only after the auth check, and every request here stops before that,
      // so no Postgres is needed -- which is also why these checks can be exact
      // about CORS rather than about the rest of the function.
      '-e', 'SUPABASE_URL=http://localhost:54321',
      '-e', 'SUPABASE_ANON_KEY=local-anon-key',
      '-e', 'SUPABASE_SERVICE_ROLE_KEY=local-service-role-key',
      '-e', 'APP_URL=https://map204.vercel.app',
      '-e', 'MAIL_FROM=Map204 <test@example.com>',
      IMAGE,
    'start',
    '--main-service',
    '/home/deno/main',
    ],
    { stdio: 'ignore' },
  )

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  let ready = false
  for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
    const probe = spawnSync('curl.exe', ['-s', '-o', 'NUL', '-w', '%{http_code}', `http://localhost:${PORT}/functions/v1/send-share-email`], {
      encoding: 'utf8',
    })
    // Any answer at all means it is listening. 404 for a wrong path is fine.
    ready = probe.status === 0 && /^\d{3}$/.test((probe.stdout || '').trim())
    if (!ready) await sleep(1000)
  }

  if (!ready) {
    cleanup()
    console.log('FAIL  the edge runtime never started listening')
    process.exit(1)
  }

  /* -- the requests ----------------------------------------------------------- */

  const ALLOWED = 'https://map204.vercel.app'
  const STRANGER = 'https://example.com'

  /**
   * One request, returning status and headers.
   *
   * `-i` and no `-X` override for OPTIONS, because the preflight has to be a real
   * preflight: `curl` with `-X OPTIONS` and no body is close enough, but the method
   * and the `Access-Control-Request-Method` header together are what the browser
   * actually sends, and the second one is only meaningful on the preflight.
   */
  function request({ method, origin, preflight, body }) {
    const args = ['-s', '-i', '-X', method, `http://localhost:${PORT}/functions/v1/send-share-email`]
    if (origin) args.push('-H', `Origin: ${origin}`)
    if (preflight) args.push('-H', 'Access-Control-Request-Method: POST')
    if (body) {
      args.push('-H', 'Content-Type: application/json')
      args.push('-d', body)
    }

    const out = execFileSync('curl.exe', args, { encoding: 'utf8' })

    // Split status line, headers and body on the first blank line.
    const split = out.indexOf('\r\n\r\n')
    const head = split < 0 ? out : out.slice(0, split)
    const lines = head.split(/\r?\n/)
    const status = Number((lines[0] || '').split(' ')[1])

    const headers = {}
    for (const line of lines.slice(1)) {
      const at = line.indexOf(':')
      if (at > 0) headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
    }

    return { status, headers, allowOrigin: headers['access-control-allow-origin'] }
  }

  /* -- 1. the preflight, from an allowed origin ------------------------------- */

  {
    checked += 1
    const res = request({ method: 'OPTIONS', origin: ALLOWED, preflight: true })

    // Not 405. This is the reported bug, and the 405 is what made it look like the
    // function had refused to send the mail rather than never being asked to.
    if (res.status !== 204) {
      fail(`the preflight answered ${res.status}, expected 204. The browser sends this before the POST, so the POST never happens.`)
    }

    if (res.allowOrigin !== ALLOWED) {
      fail(
        `the preflight's Access-Control-Allow-Origin is ${JSON.stringify(res.allowOrigin)}, ` +
          `expected ${ALLOWED}. Without it the browser discards the response and every ` +
          'email fails with a CORS error naming neither the cause nor the function.',
      )
    }

    if (!/POST/.test(res.headers['access-control-allow-methods'] || '')) {
      fail('the preflight does not allow POST.')
    }

    // The browser asks for these by name, and a preflight that does not grant them
    // is refused just as hard as one with no allow-origin at all.
    const allowedHeaders = (res.headers['access-control-allow-headers'] || '').toLowerCase()
    for (const header of ['authorization', 'content-type']) {
      if (!allowedHeaders.includes(header)) {
        fail(`the preflight does not allow the ${header} header, which every request here sends.`)
      }
    }

    if (!(res.headers.vary || '').toLowerCase().includes('origin')) {
      fail("the response has no 'Vary: Origin'. A shared cache could serve one origin's response to another.")
    }
  }

  /* -- 2. the preflight, from an origin nobody allows ------------------------ */

  {
    checked += 1
    const res = request({ method: 'OPTIONS', origin: STRANGER, preflight: true })

    if (res.status !== 204) {
      fail(`the preflight from an unlisted origin answered ${res.status}, expected 204.`)
    }

    // No allow-origin is the *correct* answer here, not a failure. It means the
    // browser refuses, which is what an allow-list is for: this function sends mail,
    // and any site on the internet being able to make it do so is an open relay.
    if (res.allowOrigin) {
      fail(
        `an unlisted origin was allowed (${JSON.stringify(res.allowOrigin)}). The origin ` +
          'must be checked against a list, or any website can send mail through this.',
      )
    }
  }

  /* -- 3. a real request, and its error --------------------------------------- */

  {
    checked += 1
    // No Authorization, so the function refuses before it touches a database.
    const res = request({
      method: 'POST',
      origin: ALLOWED,
      body: JSON.stringify({ documentId: 'doc_x', to: 'someone@example.com' }),
    })

    if (res.status !== 401) {
      fail(
        `an unauthenticated POST answered ${res.status}, expected 401. If this ever ` +
          'returns 200, the function is sending mail to whoever asked.',
      )
    }

    // The point of the whole exercise: a *failure* the browser can read.
    if (res.allowOrigin !== ALLOWED) {
      fail(
        'an error response carried no Access-Control-Allow-Origin, so the browser ' +
          'reports "failed to fetch" instead of the reason. That is what made a CORS ' +
          'bug look like a broken email.',
      )
    }
  }

  /* -- 4. a real request from a stranger -------------------------------------- */

  {
    checked += 1
    const res = request({
      method: 'POST',
      origin: STRANGER,
      body: JSON.stringify({ documentId: 'doc_x', to: 'someone@example.com' }),
    })

    if (res.allowOrigin) {
      fail(
        `a POST from an unlisted origin came back readable (${JSON.stringify(res.allowOrigin)}). ` +
          'The refusal is still made server-side, but the browser should not be able to ' +
          'read anything from here.',
      )
    }
  }

  /* -- 5. and the method it never wanted -------------------------------------- */

  {
    checked += 1
    const res = request({ method: 'GET', origin: ALLOWED })

    if (res.status !== 405) {
      fail(`a GET answered ${res.status}, expected 405.`)
    }
    if (res.allowOrigin !== ALLOWED) {
      fail('even the 405 carries no allow-origin, so the browser cannot read the refusal.')
    }
  }

  cleanup()

  if (failures === 0) {
    console.log(
      `share email, live: ${checked} requests against the real edge runtime -- the ` +
        'preflight answers, every response is readable by an allowed origin and not by ' +
        'a stranger, and the refusals still refuse.',
    )
  } else {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
})().catch((error) => {
  console.log(`FAIL  the live share-email test itself broke: ${error.message}`)
  process.exit(1)
})
