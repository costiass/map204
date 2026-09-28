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
/** Checks made, for the summary line. `failures` alone cannot say "it checked nothing". */
let checked = 0
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

    /* -- sharing with somebody who has not signed up yet ------------------- */

    /*
     * The whole point of `document_invites`, and the reason the share dialog used
     * to be a closed loop: it looked the address up and refused it when there was no
     * profile, so the only people a map could be shared with were people who
     * already had an account.
     *
     * The sequence spans two accounts and two separate signups, so this is the
     * only place it can honestly be tested:
     *
     *   1. Alice signs up.
     *   2. Alice invites bob@example.com, who does not exist yet.
     *   3. The invite waits.
     *   4. Bob signs up with that exact address.
     *   5. Bob has Alice's workspace, without anybody inviting him twice.
     *
     * Plus the two ways it can go wrong that a happy path never finds: the address
     * differing in case between the invite and the sign-up, and a double invite.
     */
    const run = (text) => {
      const file = path.join(os.tmpdir(), 'map204-invite.sql')
      fs.writeFileSync(file, text, 'utf8')
      docker(['cp', file, `${CONTAINER}:/tmp/invite.sql`], { stdio: 'ignore' })
      psql('/tmp/invite.sql')
    }

    /*
     * Runs one scalar query and returns it as a *string*.
     *
     * A string, because these queries return uuids as often as counts, and a
     * `Number(uuid)` is `NaN` -- which then goes into the next query as the literal
     * text "NaN" and Postgres rejects it. The first version of this did exactly
     * that, and the failure read as a uuid parse error rather than as a helper that
     * had thrown away what it was given.
     */
    const scalar = (expression) =>
      docker([
        'exec', CONTAINER, 'psql', '-U', 'supabase_admin', '-d', 'map204', '-t', '-A', '-c',
        `select ${expression}`,
      ])
        .trim()
        .split('\n')
        .pop()
        .trim()

    /** For the queries that really do count. */
    const count = (expression) => Number(scalar(expression))

    const aliceId = scalar("id from auth.users where email like 'first-time-%'")
    const aliceDoc = scalar(`id from public.documents where owner_id = '${aliceId}'`)

    run(
      'insert into public.document_invites (document_id, email, role, invited_by)\n' +
        `values ('${aliceDoc}', 'bob@example.com', 'editor', '${aliceId}');\n`,
    )

    if (count('count(*) from public.document_invites') !== 1) {
      fail('the pending invite was not stored')
    }

    // The same address twice is refused by the primary key rather than silently
    // doubled -- two rows would mean the claim inserts once and one invite sits
    // there forever describing a grant that already happened.
    let duplicateRefused = false
    try {
      run(
        'insert into public.document_invites (document_id, email, role, invited_by)\n' +
          `values ('${aliceDoc}', 'bob@example.com', 'viewer', '${aliceId}');\n`,
      )
    } catch {
      duplicateRefused = true
    }
    if (!duplicateRefused) {
      fail('the same address was invited twice and both invites were stored')
    }

    // A malformed address is refused by the check, rather than being stored here
    // and failing later inside the mail provider, after the dialog has already
    // told somebody it was sent.
    let malformedRefused = false
    try {
      run(
        'insert into public.document_invites (document_id, email, role, invited_by)\n' +
          `values ('${aliceDoc}', 'not-an-email', 'editor', '${aliceId}');\n`,
      )
    } catch {
      malformedRefused = true
    }
    if (!malformedRefused) {
      fail('an address with no @ was accepted as an invitation')
    }

    /*
     * Mixed case is refused too, and that refusal is *what makes case work*.
     *
     * The claim compares `document_invites.email` against `lower(auth.users.email)`.
     * That is only case-insensitive if the stored address is already lower case --
     * otherwise `Bob@` in one place and `bob@` in the other never match, and the
     * person signs up to find their share has not arrived with nothing saying why.
     *
     * So the guarantee is the `check (email = lower(email))` on the column, and that
     * is what this asserts. Bob signs up below in mixed case precisely so that the
     * two halves are tested together: the address is refused on the way *in* as an
     * invitation, and matched on the way *in* as an account.
     */
    let mixedCaseRefused = false
    try {
      run(
        'insert into public.document_invites (document_id, email, role, invited_by)\n' +
          `values ('${aliceDoc}', 'Mixed@Example.com', 'editor', '${aliceId}');\n`,
      )
    } catch {
      mixedCaseRefused = true
    }
    if (!mixedCaseRefused) {
      fail(
        'an invitation stored in mixed case was accepted. The claim lower-cases the ' +
          "sign-up address, so a mixed-case invite could never be matched and the " +
          'share would silently never arrive.',
      )
    }

    // Bob signs up. Deliberately capitalised: the claim matches on the lower-cased
    // address, and `Bob@example.com` is one person rather than two.
    run(
      [
        'insert into auth.users (',
        '  instance_id, id, aud, role, email, encrypted_password, confirmed_at,',
        '  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,',
        '  confirmation_token, recovery_token, email_change_token, email_change',
        ') values (',
        "  '00000000-0000-0000-0000-000000000000',",
        `  '${crypto.randomUUID()}',`,
        "  'authenticated', 'authenticated',",
        "  'Bob@example.com', '', now(),",
        `  '{"provider":"google","providers":["google"]}'::jsonb,`,
        `  '{"name":"Bob","picture":"","email":"Bob@example.com"}'::jsonb,`,
        "  now(), now(), '', '', '', ''",
        ');',
        '',
      ].join('\n'),
    )

    const bobId = scalar("id from auth.users where lower(email) = 'bob@example.com'")

    // `scalar`, not `count`: the role is a word, and `Number('editor')` is `NaN`,
    // which is what the first version of this assertion read. A test that fails
    // with NaN rather than with a value is a test whose failure tells you nothing.
    const bobRole = scalar(
      `role from public.document_collaborators where document_id = '${aliceDoc}' and user_id = '${bobId}'`,
    )
    if (bobRole !== 'editor') {
      fail(`the pending invite did not become a share: read "${bobRole}", expected editor`)
    }
    if (count('count(*) from public.document_invites') !== 0) {
      fail('a claimed invite was left behind, so it would be offered again')
    }

    // The role the app actually reads, derived from the two rows `fetchMyRole`
    // consults. This is the claim that matters, as opposed to the row existing.
    const bobRoleRead = scalar(
      `case when d.owner_id = '${bobId}' then 'owner' else coalesce(c.role, 'none') end ` +
        'from public.documents d left join public.document_collaborators c ' +
        `on c.document_id = d.id and c.user_id = '${bobId}' where d.id = '${aliceDoc}'`,
    )
    if (bobRoleRead !== 'editor') {
      fail(`the new account reads as "${bobRoleRead}" on the shared workspace`)
    }

    /* -- who can read whose profile ----------------------------------------- */

    /*
     * The "Unknown user" bug, and the claim underneath it.
     *
     * `ShareDialog` showed "Unknown user" on every shared row, because
     * `shares_document_with` decided whether two accounts share a workspace by
     * joining `document_collaborators` against itself -- and the owner is
     * deliberately not in that table. So the function could never relate the owner
     * to anybody, RLS refused, and the embedded profile came back null.
     *
     * RLS needs a session to evaluate, so it cannot be tested from in here. What
     * *can* be tested is the claim the whole diagnosis rests on, and it is the part
     * that was never checked: that the owner has no membership row, and that a
     * function which never mentions `documents.owner_id` is therefore structurally
     * unable to relate them.
     *
     * If somebody "simplifies" `shares_document_with` back to a self-join, or adds an
     * owner row to make it work, this is the test that notices -- and it explains
     * which of the two happened.
     */
    {
      const ownerRows = count(
        `count(*) from public.document_collaborators where document_id = '${aliceDoc}' and user_id = '${aliceId}'`,
      )
      if (ownerRows !== 0) {
        fail(
          `the workspace owner has ${ownerRows} row(s) in document_collaborators. The ` +
            'schema says there is deliberately none -- ownership lives in ' +
            'documents.owner_id -- and shares_document_with is written on the ' +
            'assumption. Check which of those two changed.',
        )
      }

      const body = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20261001000012_profile_readable_by_owner.sql'),
        'utf8',
      )
      checked += 1
      // Stripped of comments, so a function *described* in prose is not mistaken
      // for one that reads the column.
      const code = body
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\$\$[\s\S]*?\$\$/, (block) => block)

      const fnStart = code.indexOf('create or replace function public.shares_document_with')
      const fnBody = fnStart < 0 ? '' : code.slice(fnStart, fnStart + 1400)

      // `documents` and `owner_id`, not `documents.owner_id`: the function aliases
      // the table to `d` and writes `d.owner_id`, so the first version of this
      // assertion looked for a string the correct code does not contain and failed
      // it. A check that is wrong about the right answer is worse than no check.
      if (!/\bfrom\s+public\.documents\b/.test(fnBody) || !/\bowner_id\b/.test(fnBody)) {
        fail(
          'shares_document_with no longer reads the documents table. Without it the ' +
            'function cannot relate a workspace owner to anybody, because the owner ' +
            'has no document_collaborators row -- and every profile read is refused, ' +
            'so every shared row renders as "Unknown user".',
        )
      }
    }

    /* -- and the invitation records who sent it ------------------------------ */

    /*
     * `invited_by` is filled from the session, not sent by the client.
     *
     * It was `not null` with no default and the client never supplied it, so every
     * pending invite failed with `null value in column "invited_by"`. A client that
     * *did* supply it could supply any value -- an editor recording an invitation as
     * coming from the owner -- so it is filled by a trigger from `auth.uid()`.
     *
     * Inserted here with no session, which is the branch that leaves the column
     * alone: the test is not signed in as anybody, and `auth.uid()` is null, so
     * this cannot prove the trigger fills it in. What it *can* prove is that the
     * trigger exists, which is the half that was missing when it failed.
     */
    {
      const body = fs.readFileSync(
        path.join(__dirname, '..', 'supabase', 'migrations', '20261001000011_invited_by_from_session.sql'),
        'utf8',
      )
      checked += 1
      if (!/create trigger trg_set_invited_by[\s\S]*?before insert on public\.document_invites/.test(body)) {
        fail(
          'no before-insert trigger sets document_invites.invited_by from the session. ' +
            'The column is NOT NULL and the client deliberately does not send it, so ' +
            'every pending invitation fails with a not-null violation.',
        )
      }
    }
  } finally {
    cleanup()
  }

  if (failures === 0) {
    console.log(
      'signup: a first and a second sign-in each create an account, a profile, ' +
        'settings, a workspace and two pages; and an invite to an address that had ' +
        'no account becomes a share the moment it signs up',
    )
  } else {
    console.log(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
})().catch((error) => {
  console.log(`FAIL  the signup test itself broke: ${error.message}`)
  process.exit(1)
})
