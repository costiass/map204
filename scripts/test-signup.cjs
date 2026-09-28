// Build the Map204 schema in a throwaway Postgres and sign a new user up.
//
// The failure this exists to catch: a trigger on `auth.users` that throws rolls
// back the whole signup transaction, GoTrue reports "Database error saving new
// user", and the browser sends the person back to the sign-in page looking like
// Google or Supabase is broken. Nothing in the front end can see it, `tsc` cannot,
// and every unit test passes -- because the cause is a row in `pg_trigger` on a
// table this repository does not own.
//
// So this is the only kind of test that can find it: a real Postgres, the real
// migrations, and the row GoTrue inserts for a first sign-in.
//
// Docker is required. If it is not there, this *skips* rather than fails: a test
// that cannot run must not be a red test, or it gets deleted.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const CONTAINER = 'map204-signup-test'
const IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.166'
const MIGRATIONS = path.join(__dirname, '..', 'supabase', 'migrations')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

const skip = (message) => {
  console.log(`SKIP  ${message}`)
  process.exit(0)
}

/* -- is Docker there? ------------------------------------------------------ */

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })
}

;(async () => {
  try {
    docker(['version', '--format', '{{.Server.Version}}'])
  } catch (error) {
    skip('Docker is not available, so the signup path cannot be exercised. ' + String(error.message).slice(0, 80))
  }

  /* -- the image ------------------------------------------------------------- */

  try {
    docker(['image', 'inspect', IMAGE], { stdio: 'ignore' })
  } catch {
    skip(`the Postgres image ${IMAGE} is not present locally and this will not pull it`)
  }

  /* -- build ----------------------------------------------------------------- */

  docker(['rm', '-f', CONTAINER], { stdio: 'ignore' })

  const cleanup = () => {
    try {
      docker(['rm', '-f', CONTAINER], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
  }

  try {
    docker(['run', '-d', '--name', CONTAINER, '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=map204', IMAGE], {
      stdio: 'ignore',
    })

    /*
     * Wait for it, by asking the question the test actually cares about --
     * repeatedly, and agreeing only when it keeps saying yes.
     *
     * `pg_isready` is not enough: the image runs a *temporary* server while it
     * initialises the cluster, and that answers happily before the container has
     * settled. One successful `psql` is not enough either, because that temporary
     * server is then shut down and restarted -- so a single success is followed by
     * "the database system is shutting down" a moment later, which is what the
     * first version of this test did.
     *
     * Three consecutive successes a second apart, the counter reset on any
     * failure. The final server stays up, so it clears; the temporary one does not
     * survive three probes.
     */
    const REQUIRED_CONSECUTIVE = 3
    let consecutive = 0
    let ready = false
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      const probe = spawnSync(
        'docker',
        ['exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'map204', '-t', '-A', '-c', 'select 1'],
        { encoding: 'utf8' },
      )
      if (probe.status === 0 && String(probe.stdout).trim() === '1') {
        consecutive += 1
        if (consecutive >= REQUIRED_CONSECUTIVE) ready = true
      } else {
        consecutive = 0
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!ready) {
      cleanup()
      fail('the Postgres container never became ready')
      process.exit(1)
    }

    const psql = (file, extraArgs = []) =>
      docker(['exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'map204', '-v', 'ON_ERROR_STOP=1', '-q', '-f', file, ...extraArgs])

    /* -- the two things migrations 4 needs that a bare container lacks ------- */

    // `realtime.topic()` and `realtime.messages` belong to the Realtime service.
    // Migration 4 publishes pages; the signup path does not use either. Stubbed
    // rather than skipped so the chain is applied whole and in order, which is the
    // only way a migration-order problem can show up.
    const stub = path.join(os.tmpdir(), 'map204-realtime-stub.sql')
    fs.writeFileSync(
      stub,
      [
        'create schema if not exists realtime;',
        'create or replace function realtime.topic() returns text language sql',
        "as $$ select current_setting('realtime.topic', true) $$;",
        'grant usage on schema realtime to public;',
        'create table if not exists realtime.messages (',
        '  id bigint generated always as identity primary key,',
        '  topic text not null, extension text not null, payload jsonb,',
        '  event text, private boolean default false',
        ');',
        '',
      ].join('\n'),
      'utf8',
    )
    docker(['cp', stub, `${CONTAINER}:/tmp/stub.sql`], { stdio: 'ignore' })
    psql('/tmp/stub.sql')

    /* -- the migrations, in order -------------------------------------------- */

    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      docker(['cp', path.join(MIGRATIONS, file), `${CONTAINER}:/tmp/${file}`], { stdio: 'ignore' })
      try {
        psql(`/tmp/${file}`)
      } catch (error) {
        fail(`migration ${file} did not apply:\n${String(error.stdout || error.stderr || error.message).slice(0, 400)}`)
        cleanup()
        process.exit(1)
      }
    }

    /* -- sign a new user up -------------------------------------------------- */

    /*
     * A Google profile, so the metadata is what Google actually sends: `name` and
     * `picture` rather than Supabase's `full_name` and `avatar_url`. The signup path
     * has to cope with both, and only one of them is ever present.
     *
     * A function of its arguments rather than a literal, because this is run twice
     * and the second run has to be a *different account*. A fixed uuid here meant
     * the second insert collided on the primary key, and the test reported a
     * duplicate-key error while looking, to anyone reading it, like a real defect.
     */
    const signup = path.join(os.tmpdir(), 'map204-signup.sql')
    const signupSql = (userId, email, name) =>
      [
        'insert into auth.users (',
        '  instance_id, id, aud, role, email, encrypted_password, confirmed_at,',
        '  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,',
        '  confirmation_token, recovery_token, email_change_token, email_change',
        ') values (',
        "  '00000000-0000-0000-0000-000000000000',",
        `  '${userId}',`,
        "  'authenticated', 'authenticated',",
        `  '${email}', '', now(),`,
        `  '{"provider":"google","providers":["google"]}'::jsonb,`,
        `  '{"name":"${name}","picture":"https://lh3.googleusercontent.com/a/x","email":"${email}"}'::jsonb,`,
        "  now(), now(), '', '', '', ''",
        ');',
        '',
      ].join('\n')

    const runSignup = async (label) => {
      fs.writeFileSync(signup, signupSql(crypto.randomUUID(), `${label}-${Date.now()}@gmail.com`, label), 'utf8')
      docker(['cp', signup, `${CONTAINER}:/tmp/signup.sql`], { stdio: 'ignore' })
      psql('/tmp/signup.sql')
    }

    fs.writeFileSync(
      signup,
      signupSql(crypto.randomUUID(), `first-time-${Date.now()}@gmail.com`, 'First Time'),
      'utf8',
    )
    docker(['cp', signup, `${CONTAINER}:/tmp/signup.sql`], { stdio: 'ignore' })

    try {
      psql('/tmp/signup.sql')
    } catch (error) {
      fail(
        'a first sign-in failed. This is the whole point of the test: a trigger on ' +
          'auth.users that throws rolls back the signup, GoTrue reports "Database ' +
          'error saving new user", and the browser sends the person back to the ' +
          'sign-in page looking like Google is at fault.\n  ' +
          String(error.stdout || error.stderr || error.message).slice(0, 500),
      )
      cleanup()
      process.exit(1)
    }

    /* -- what the signup was supposed to produce ----------------------------- */

    const counts = docker([
      'exec',
      CONTAINER,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'map204',
      '-t',
      '-A',
      '-F',
      '|',
      '-c',
      [
        'select',
        "  (select count(*) from auth.users) || '|' ||",
        "  (select count(*) from public.profiles) || '|' ||",
        "  (select count(*) from public.user_settings) || '|' ||",
        "  (select count(*) from public.documents) || '|' ||",
        "  (select count(*) from public.pages)",
      ].join('\n'),
    ])
      .trim()
      .split('\n')
      .pop()
      .trim()

    const [users, profiles, settings, documents, pages] = counts.split('|').map((n) => Number(n.trim()))

    if (users !== 1) fail(`the account was not created (auth.users has ${users})`)
    if (profiles !== 1) fail(`no profile (${profiles}) -- trg_sync_profile did not fire`)
    if (settings !== 1) fail(`no settings row (${settings}) -- trg_create_settings did not fire`)
    if (documents !== 1) fail(`no workspace (${documents}) -- trg_create_tutorial_workspace did not fire`)
    if (pages !== 2) fail(`the welcome workspace has ${pages} pages, expected 2`)

    /* -- and the sign-up path a second account takes ------------------------- */

    // The welcome workspace is created "once per account, ever", so the guard at the
    // top of create_tutorial_workspace is the branch a *second* signup actually
    // takes. A first one never reaches it, so a test that only signs one person up
    // leaves the whole early-return path unexercised.
    try {
      await runSignup('Second Time')
      const after = docker([
        'exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'map204', '-t', '-A', '-F', '|', '-c',
        "select (select count(*) from public.documents) || '|' || (select count(*) from public.pages)",
      ])
        .trim()
        .split('\n')
        .pop()
        .trim()
      const [docs2, pages2] = after.split('|').map((n) => Number(n.trim()))
      if (docs2 !== 2) fail(`the second account got ${docs2} workspaces, expected 2`)
      if (pages2 !== 4) fail(`the second account produced ${pages2} pages in total, expected 4`)
    } catch (error) {
      fail(
        'a *second* sign-in failed, which exercises the early-return branch in ' +
          'create_tutorial_workspace:\n  ' +
          String(error.stdout || error.stderr || error.message).slice(0, 300),
      )
    }
  } finally {
    cleanup()
  }

  if (failures === 0) {
    console.log(
      'signup: a first and a second sign-in each create an account, a profile, ' +
        'settings, a workspace and two pages',
    )
  } else {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
})().catch((error) => {
  console.log(`FAIL  the signup test itself broke: ${error.message}`)
  process.exit(1)
})
