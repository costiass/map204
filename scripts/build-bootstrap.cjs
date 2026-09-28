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

const EPILOGUE = `
-- -----------------------------------------------------------------------------
-- 3. Record these as applied
-- -----------------------------------------------------------------------------
-- \`supabase db push\` compares its history table against supabase/migrations.
-- Left empty it would try to re-apply everything above, and fail on the first
-- \`create policy\`. These rows say: done.
do $$
begin
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[],
    inserted_at timestamptz not null default now()
  );
end;
$$;

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
