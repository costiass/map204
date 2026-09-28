const fs = require('fs')
const path = require('path')

/**
 * Guards the generated bootstrap: it must contain every migration verbatim, drop
 * everything it creates, and end by recording the versions it applied. These are
 * the failures that would only show up as a 500 in the browser after a manual
 * paste, so they are checked here instead.
 */

const MIGRATIONS_DIR = 'supabase/migrations'
const BOOTSTRAP = 'supabase/bootstrap.sql'

const bootstrap = fs.readFileSync(BOOTSTRAP, 'utf8')
const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

let failed = 0
const check = (ok, label, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`)
}

check(files.length > 0, 'migrations exist', `${files.length} files`)

// 1. Every migration appears verbatim.
for (const name of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8').trim()
  check(bootstrap.includes(sql), `includes ${name}`)
}

// 2. Every table and function the migrations create is dropped first. The
//    history table is exempt: it is created inside a guarded `do` block.
const created = {
  tables: [...bootstrap.matchAll(/create table(?: if not exists)? (?:\w+\.)?(\w+)/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'schema_migrations'),
  functions: [
    ...bootstrap.matchAll(/create or replace function (?:public\.)?(\w+)\(/g),
  ].map((m) => m[1]),
}
for (const table of created.tables) {
  check(
    new RegExp(`drop table if exists (public\\.)?${table} cascade`).test(bootstrap),
    `drops table ${table} before recreating it`,
  )
}
for (const fn of created.functions) {
  check(
    new RegExp(`drop function if exists (public\\.)?${fn}\\(`).test(bootstrap),
    `drops function ${fn} before recreating it`,
  )
}

// 3. The history is cleared, then re-recorded with every version — otherwise
//    `db push` re-applies everything and dies on the first `create policy`.
const versions = files.map((f) => f.split('_')[0])
const clearedBeforeInsert =
  bootstrap.indexOf('delete from supabase_migrations.schema_migrations') <
  bootstrap.indexOf('insert into supabase_migrations.schema_migrations')
check(clearedBeforeInsert, 'clears the migration history before recording it')

for (const version of versions) {
  check(bootstrap.includes(`('${version}',`), `records version ${version} as applied`)
}
check(
  /on conflict \(version\) do nothing/.test(bootstrap),
  'history insert is idempotent',
)

// 4. The invariant this schema exists to hold: no policy reads another RLS table
//    directly. Found by scanning the generated policy expressions.
const policyBlocks = [...bootstrap.matchAll(/create policy[\s\S]*?;/g)].map((m) => m[0])
const recursive = policyBlocks.filter((block) =>
  /(qual|with check)[\s\S]*?\b(document_collaborators|documents|pages|profiles)\b[\s\S]*\b(select|exists)\b/i.test(
    block,
  ) && /from\s+public\.(document_collaborators|documents|pages|profiles)/i.test(block),
)
check(
  recursive.length === 0,
  'no policy queries another RLS table directly',
  recursive.length ? recursive.map((b) => b.split('\n')[0]).join(' | ') : `${policyBlocks.length} policies scanned`,
)

// 5. auth.uid() returns uuid and the user columns are uuid, so they must be
//    compared directly. A cast would make Postgres compare text with uuid and
//    fail every query with "operator does not exist: uuid = text" — the exact
//    error an earlier schema produced.
check(
  !/auth\.uid\(\)\s*::/.test(bootstrap),
  'auth.uid() is never cast',
  (bootstrap.match(/auth\.uid\(\)\s*::/g) || []).length + ' cast',
)
check(
  !/owner_id text|user_id text/.test(bootstrap),
  'user id columns are uuid, not text',
)

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
