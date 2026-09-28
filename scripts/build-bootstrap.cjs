const fs = require('fs')
const path = require('path')

/**
 * Builds `supabase/bootstrap.sql`: the whole schema as one file that can be
 * pasted into the Supabase SQL Editor.
 *
 * It exists for the situations where `supabase db push` cannot run: no CLI, no
 * database password, or a history table that disagrees with the repository so
 * badly that the CLI refuses to start. The SQL Editor needs only dashboard
 * access, and the result is the same schema either way.
 *
 * It is generated, never hand-edited, and `test-bootstrap-fresh` fails if the
 * committed copy has drifted from the migrations.
 */

const MIGRATIONS_DIR = 'supabase/migrations'
const OUTPUT = 'supabase/bootstrap.sql'

/** Everything the migrations create, in the order they create it. */
function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))
}

/**
 * Everything the migrations create, derived from the files rather than listed
 * by hand. A hand-written list goes stale the moment a migration adds an
 * object, and the failure only shows up when the bootstrap is pasted into a live
 * database — which is exactly what the test below is there to prevent.
 */
function createdObjects() {
  const tables = new Set()
  const functions = new Set()

  for (const { sql } of migrationFiles()) {
    for (const m of sql.matchAll(/create table(?: if not exists)? (?:public\.)?(\w+)/g)) {
      if (m[1] !== 'schema_migrations') tables.add(m[1])
    }
    for (const m of sql.matchAll(
      /create or replace function (?:public\.)?(\w+)\s*\(\s*([^)]*)\)/g,
    )) {
      // The argument list has to be reproduced verbatim, or the drop misses.
      const args = m[2]
        .split(',')
        .map((a) => a.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .join(', ')
      functions.add(`${m[1]}(${args})`)
    }
  }

  return { tables: [...tables].sort(), functions: [...functions].sort() }
}

const created = createdObjects()

const preamble = () => `-- =============================================================================
-- Map204 — complete schema, generated from supabase/migrations
-- =============================================================================
-- DO NOT EDIT. Rebuild it with:  npm run bootstrap
--
-- A bootstrap for a database that is empty, or one built from an older set of
-- migrations. It drops what the project owns, clears the migration history so
-- \`supabase db push\` starts from a clean slate, then applies every migration
-- in order.
--
-- For an incremental change, do not use this file: add a migration and run
-- \`supabase db push\`. This file is the whole schema, not a delta.
--
-- Safe to run more than once.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Remove anything a previous version of this schema left behind
-- -----------------------------------------------------------------------------
-- Both lists are read out of the migrations, so a new table or function cannot
-- slip through without a matching drop. Triggers live on their functions, so
-- CASCADE takes those with them.
${created.tables.map((t) => `drop table if exists public.${t} cascade;`).join('\n')}

${created.functions.map((f) => `drop function if exists public.${f} cascade;`).join('\n')}

-- -----------------------------------------------------------------------------
-- 1. Forget the old migration history
-- -----------------------------------------------------------------------------
-- The CLI refuses to push when the database records versions that are not in
-- the repository. Clearing the table lets \`db push\` apply everything from the
-- first migration and record it properly, so this never has to happen again.
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The schema
-- -----------------------------------------------------------------------------
`


/**
 * The history rows for the migrations this file applies.
 *
 * Without them the history table is empty, the CLI believes nothing has run,
 * and it tries to apply all five again — which fails on the first
 * `create policy`, because that has no `if not exists`. Recording them makes the
 * next `supabase db push` a no-op, so a migration added later behaves normally.
 */
function historyRows() {
  return migrationFiles()
    .map((file) => {
      const [version, ...rest] = file.name.replace(/\.sql$/, '').split('_')
      return `    ('${version}', '${rest.join('_')}')`
    })
    .join(',\n')
}

/**
 * Every function this schema is supposed to leave behind.
 *
 * Read out of the migrations rather than listed by hand, so adding a migration
 * that creates a function cannot be forgotten here — which is the whole point,
 * since this list is what the bootstrap checks itself against before claiming
 * to have succeeded.
 */
function verificationRows() {
  const names = new Set()
  for (const { sql } of migrationFiles()) {
    for (const m of sql.matchAll(
      /create or replace function\s+(?:public\.)?(\w+)\s*\(/g,
    )) {
      names.add(m[1])
    }
  }
  return [...names]
    .sort()
    .map((name) => `    '${name}'`)
    .join(',\n')
}

const VERIFICATION_ROWS = verificationRows()

const EPILOGUE = `
-- -----------------------------------------------------------------------------
-- 3. Check the schema is actually complete, then record it as applied
-- -----------------------------------------------------------------------------
-- \`supabase db push\` compares its history table against supabase/migrations.
-- Left empty it would try to re-apply everything above and fail on the first
-- \`create policy\`. These rows say: done.
--
-- **The check comes first, and it is the important part.**
--
-- Recording the history unconditionally is how this file produced a database
-- that reported "up to date" while missing functions the app called. The SQL
-- Editor continues past a failed statement, so a migration that errored halfway
-- left the objects after it uncreated — and the unconditional insert still
-- marked every version as applied. \`db push\` then reported nothing to do, and
-- the app got 404s for functions the history claimed were there.
--
-- So the rows are only written if every object this schema is supposed to
-- create actually exists. If something is missing, this raises, the transaction
-- unwinds, and the history stays empty — which is a *visible* failure, because
-- the next \`db push\` will try again and tell you what went wrong.
do $$
declare
  missing text;
begin
  select string_agg(name, ', ') into missing
  from unnest(array[
${VERIFICATION_ROWS}
  ]) as name
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = name
  );

  if missing is not null then
    raise exception
      'Bootstrap incomplete — these functions do not exist: %. '
      'A statement above failed, and the SQL Editor carries on past an error. '
      'The migration history has NOT been recorded, so "supabase db push" will '
      'report the real problem.', missing;
  end if;
end;
$$;

-- The history table itself, which is normally created by the CLI. Needed here
-- because a bootstrap may be pasted into a database the CLI has never touched.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[],
  inserted_at timestamptz not null default now()
);

insert into supabase_migrations.schema_migrations (version, name)
values
${historyRows()}
on conflict (version) do nothing;

-- =============================================================================
-- Done. Check it worked:
--
--   select tablename from pg_tables where schemaname = 'public' order by 1;
--   -- document_collaborators, documents, pages, profiles, user_settings
--
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' order by 1, 2;
--
-- From here on, change the schema with a new migration and \`supabase db push\`.
-- This file is the whole schema, not a delta.
-- =============================================================================
`

function build() {
  const files = migrationFiles()
  const header = files.map((f) => `-- ---- ${f.name} ${'-'.repeat(Math.max(0, 66 - f.name.length))}`).join('\n')

  const body = files.map(({ name, sql }) => `-- =============================================================================\n-- ${name}\n-- =============================================================================\n${sql.trim()}\n`).join('\n')

  return `${preamble()}${header}\n\n${body}${EPILOGUE}`
}

const output = build()

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
  if (existing !== output) {
    console.error('bootstrap.sql is out of date with the migrations. Run: npm run bootstrap')
    process.exit(1)
  }
  console.log(`bootstrap.sql is current (${migrationFiles().length} migrations)`)
} else {
  fs.writeFileSync(OUTPUT, output)
  console.log(`wrote ${OUTPUT} from ${migrationFiles().length} migrations`)
}
