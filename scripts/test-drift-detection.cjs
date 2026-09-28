// Verifies the parsing half of the workflow's drift detection: turning whatever
// the CLI printed into a list of versions, then subtracting the ones in git.
const fs = require('fs')
const { execSync } = require('child_process')

const localVersions = () =>
  fs
    .readdirSync('supabase/migrations')
    .map((f) => f.match(/^([0-9]{3,})/))
    .filter(Boolean)
    .map((m) => m[1])
    .sort()

// The CLI pretty-prints a table, and its timestamp column starts with the year
// (`2026-09-28 09:00:00`), so a loose `[0-9]{3,}` matches a bare `2026` and the
// workflow would try to repair a version called "2026". Supabase requires a
// 14-digit version, so requiring 14 is the precise rule, not a workaround.
const parse = (raw) => {
  const found = String(raw).match(/[0-9]{14,}/g) ?? []
  return [...new Set(found)].sort()
}

const orphans = (remoteRaw) =>
  parse(remoteRaw).filter((v) => !localVersions().includes(v))

// Verbatim from the failing run.
const migrationList = `
   Local            | Remote           | Time (UTC)            
  ------------------|------------------|-----------------------
   \` \`              | \`20260920090000\` | \`2026-09-20 09:00:00\` 
   \` \`              | \`20260920090100\` | \`2026-09-20 09:01:00\` 
   \` \`              | \`20260921091500\` | \`2026-09-21 09:15:00\` 
   \` \`              | \`20260921091600\` | \`2026-09-21 09:16:00\` 
   \` \`              | \`20260922093000\` | \`2026-09-22 09:30:00\` 
   \` \`              | \`20260927081500\` | \`2026-09-27 08:15:00\` 
   \` \`              | \`20260927081600\` | \`2026-09-27 08:16:00\` 
   \` \`              | \`20260928090000\` | \`2026-09-28 09:00:00\` 
   \` \`              | \`20260928090100\` | \`2026-09-28 09:01:00\` 
   \` \`              | \`20260928090200\` | \`2026-09-28 09:02:00\` 
   \`20261001090000\` | \` \`              | \`2026-10-01 09:00:00\` 
   \`20261001090100\` | \` \`              | \`2026-10-01 09:01:00\` 
   \`20261001090200\` | \` \`              | \`2026-10-01 09:02:00\` 
   \`20261001090300\` | \` \`              | \`2026-10-01 09:03:00\` 
   \`20261001090400\` | \` \`              | \`2026-10-01 09:04:00\` 
`

// What `supabase db query` would print for the same database.
const dbQuery = `
 v 
------------------------------
 20260920090000 20260928090200 
------------------------------
(1 row)
`

const inStep = localVersions().map((v) => `${v} `).join(' ')

const cases = [
  ['migration list, drifted', migrationList, 10],
  ['db query, drifted', dbQuery, 2],
  ['migration list, in step', `| \`${inStep.trim()}\` |`, 0],
  ['empty database', '', 0],
  ['null string_agg', ' v \n----\n \n----\n(1 row)\n', 0],
]

let failed = 0
for (const [name, input, expected] of cases) {
  const got = orphans(input)
  const ok = got.length === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got.length})`)
  if (got.length) console.log(`        ${got.join(' ')}`)
}

process.exit(failed === 0 ? 0 : 1)
