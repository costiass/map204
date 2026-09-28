const fs = require('fs')

/**
 * The drift detector, in a form that can be tested without a database.
 *
 * The problem this solves: `supabase_migrations.schema_migrations` on the
 * database and `supabase/migrations` in the repository can disagree, and the CLI
 * refuses to resolve it. The only question worth asking is which versions the
 * database records that the repository does not have.
 *
 * The trap it is careful about: the CLI pretty-prints a table, and its timestamp
 * column looks like a version. A loose pattern reads `2026` out of
 * `2026-09-28 09:00:00` and decides every date is a migration. Hence the
 * 14-digit requirement, which is also exactly what Supabase mandates.
 */

const VERSIONS = [...fs.readdirSync('supabase/migrations')]
  .map((name) => /^(\d{14})/.exec(name)?.[1])
  .filter(Boolean)
  .sort()

const parse = (raw) => {
  const found = raw.match(/\b\d{14,}\b/g) ?? []
  return [...new Set(found)].sort()
}

const orphans = (remoteRaw) => parse(remoteRaw).filter((v) => !VERSIONS.includes(v))

/* ------------------------------------------------------------------ */
/* Cases                                                                */
/* ------------------------------------------------------------------ */

// Verbatim shape from a real failing run, but with the version numbers written
// out rather than taken from the repository.
//
// They used to be the real ones with a hard-coded expected count, which quietly
// made this a tripwire for "did somebody renumber a migration". Renumbering is
// legitimate when the database is being rebuilt, and then the test failed for a
// reason a reader could not see. Invented versions make the expectations below
// arithmetic rather than archaeology.
const REMOTE_ONLY = [
  '20990101010101',
  '20990101010102',
  '20990101010103',
  '20990101010104',
  '20990101010105',
]

const migrationList = [
  '   Local            | Remote           | Time (UTC)            ',
  '  ------------------|------------------|-----------------------',
  ...REMOTE_ONLY.map((v, i) => `   \` \`              | \`${v}\` | \`2099-01-01 01:0${i}\` `),
  // A version the repository *does* have, in the Local column, so the fixture
  // covers both halves of a drift report: absent remotely, and pending locally.
  ...VERSIONS.map(
    (v, i) => `   \`${v}\` | \` \`              | \`2099-01-02 02:0${i % 10}\` `,
  ),
  '',
].join('\n')

// What `supabase db query` prints for the same database.
const dbQuery = `\n v \n----------------------------\n ${REMOTE_ONLY.slice(0, 2).join(' ')} \n---- \n(1 row)\n`

const inStep = VERSIONS.map((v) => `${v} `).join(' ')

const cases = [
  // Every remote-only version is an orphan. A version that is merely *pending*
  // is not, which is the whole distinction: that one is what `db push` is for.
  ['migration list, drifted', migrationList, REMOTE_ONLY.length],
  ['db query, drifted', dbQuery, 2],
  ['migration list, in step', `| \`${inStep.trim()}\` |`, 0],
  ['empty database', '', 0],
  ['null string_agg', ' v \n----\n \n----\n(1 row)\n', 0],
  // A timestamp column must not be mistaken for a version.
  ['dates are not versions', '| ` ` | `2026-09-28 09:00:00` |\n', 0],
  ['short numbers are not versions', '| 2026 | 202609 |', 0],
  ['a pending migration is not drift', VERSIONS.map((v) => `| \`${v}\` | \` \` |`).join('\n'), 0],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = orphans(input)
  const ok = got.length === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got.length})`)
  if (!ok && got.length > 0) {
    console.log(`      would report as drift: ${got.join(' ')}`)
  }
}

if (failed > 0) {
  console.log(`\n${failed} case(s) failed.`)
  process.exit(1)
}
console.log(`\n${cases.length} cases passed. ${VERSIONS.length} migrations in the repository.`)
