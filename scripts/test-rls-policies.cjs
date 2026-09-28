// Enforces the rule migration 001 states for the whole schema:
//
//   **a policy never queries another table that also has RLS.**
//
// It is worth stating because breaking it is cheap and the failure is not: the
// first version of this schema did it, and Postgres answered with
//
//   42P17  infinite recursion detected in policy for relation "documents"
//
// which is not a permissions error, it is a dead application — every request
// fails and nothing says why.
//
// It survives being broken for two reasons. Sometimes the chain happens to
// terminate (a helper further down is `security definer`, so RLS stops
// re-entering), so the policy merely *works*, and there is no symptom to
// investigate. And the rule is written in a comment, which no tool reads.
//
// So it is checked here instead: every policy is parsed, the tables it names are
// looked up in the RLS-enabled set, and a direct reference to an RLS table is a
// failure. Cross-table access belongs in a `security definer` helper, and the
// helpers are named here so a new one is added deliberately.

const fs = require('fs')
const path = require('path')

const dir = 'supabase/migrations'
const files = fs
  .readdirSync(dir)
  .filter((name) => name.endsWith('.sql'))
  .sort()

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

/* ---- which tables have RLS, and which functions are security definer ---- */

const allSql = files.map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n')

const rlsTables = new Set(
  [...allSql.matchAll(/alter table\s+(?:public\.)?(\w+)\s+enable row level security/gi)].map(
    (m) => m[1],
  ),
)

const definerFunctions = new Set(
  [...allSql.matchAll(/create or replace function\s+(?:public\.)?(\w+)\s*\([\s\S]*?security definer/gi)]
    .map((m) => m[1]),
)

if (rlsTables.size === 0) {
  console.log('FAIL  no tables with RLS were found — the scan is not working')
  process.exit(1)
}

/* ---- every table in the schema must have RLS on ---- */

// A policy is inert until the table has RLS enabled, and a table with policies
// but no RLS is worse than one with neither: it looks protected in review and is
// wide open at runtime. This is not hypothetical — rewriting the schema left the
// `enable row level security` statements out, and the policies below were sitting
// there doing nothing. The failure is invisible until somebody reads another
// person's notes, so it is checked rather than trusted.

const declared = new Set(
  [...allSql.matchAll(/create table if not exists\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]),
)

for (const table of declared) {
  if (!rlsTables.has(table)) {
    fail(
      `table "${table}" is created but RLS is never enabled on it. ` +
        `Its policies would be inert and every row would be readable.`,
    )
  }
}

/* ---- the state that actually runs ---- */

const allPolicies = []
for (const name of files) {
  const sql = fs.readFileSync(path.join(dir, name), 'utf8')
  for (const match of sql.matchAll(
    /create policy\s+("[^"]+"|\w+)\s*\r?\n?\s*on\s+(?:public\.)?(\w+)\s+for\s+(\w+)\s*(?:using|with check)?\s*\(([\s\S]*?)\)\s*;/gi,
  )) {
    allPolicies.push({ file: name, label: match[1], table: match[2], command: match[3], expression: match[4] })
  }
}

// A later migration may replace a policy with the same name, and a migration
// must never be edited once applied — so the definition in 001 stays on disk
// forever even after 011 has superseded it. Only the *last* definition of a
// name is live, so that is the only one worth checking. Without this the test
// would fail on history rather than on the schema, and the correct response
// would be to weaken the test.
const live = new Map()
for (const policy of allPolicies) {
  live.set(`${policy.table}:${policy.label.replace(/"/g, '')}`, policy)
}

if (live.size === 0) {
  console.log('FAIL  no policies were found — the scan is not working')
  process.exit(1)
}

for (const { file, label, table, expression } of live.values()) {
  {
    const policyName = label.replace(/"/g, '')

    // Table references inside the expression: `from x`, `join x`, `on x.`,
    // `x.column`, `insert into x`, `update x`.
    const referenced = new Set()
    for (const m of expression.matchAll(/\bfrom\s+(?:public\.)?(\w+)/gi)) referenced.add(m[1])
    for (const m of expression.matchAll(/\bjoin\s+(?:public\.)?(\w+)/gi)) referenced.add(m[1])

    for (const other of referenced) {
      if (!rlsTables.has(other)) continue

      // Reading a helper that is `security definer` is the sanctioned way to
      // reach an RLS table; the function does the reading, not the policy.
      const usesHelper = [...definerFunctions].some((fn) =>
        new RegExp(`\\b${fn}\\s*\\(`, 'i').test(expression),
      )

      if (!usesHelper) {
        fail(
          `${file}: policy "${policyName}" on ${table} queries ${other}, which has RLS. ` +
            `Move the check into a security definer function.`,
        )
      }
    }

    // A function called by the policy that does *not* exist would make every
    // request fail with "function does not exist" — as invisible as a wrong
    // policy, and just as total.
    for (const m of expression.matchAll(/\b(public\.)?(\w+)\s*\(\s*[a-z_]/gi)) {
      const called = m[2]
      if (!called.startsWith('can_') && !called.startsWith('shares_') && !called.startsWith('realtime_')) {
        continue
      }
      const defined = new RegExp(`create or replace function\\s+(?:public\\.)?${called}\\s*\\(`, 'i')
      if (!defined.test(allSql)) {
        fail(`${file}: policy "${policyName}" calls ${called}(), which no migration defines`)
      }
    }
  }
}

if (failures === 0) {
  console.log(
    `policies: none reads an RLS table directly across ${files.length} migrations ` +
      `(${rlsTables.size} RLS tables, ${definerFunctions.size} definer helpers)`,
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
