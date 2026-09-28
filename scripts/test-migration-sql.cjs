// Checks the migrations for the mistake that hand-written SQL hides from every
// other tool in the repo: a function body written in one language and declared in
// another.
//
//   language sql     + a declare / begin / end / perform / into body
//                   = 42601 syntax error, at *parse* time
//
// This is not a style preference. Postgres validates the function body's language
// before it runs anything, so the statement fails even when the logic is perfect.
// And the message points at the offending keyword rather than the cause:
//
//   ERROR: syntax error at or near "integer"
//   At statement: 3
//   declare
//     ^
//
// which reads like a problem with `integer` and is really a problem with the
// word `language` three lines above.
//
// `tsc`, `oxlint` and the type checker never see SQL, and nothing catches this
// until a migration runs against the live database — where a mid-sequence failure
// leaves the schema half-applied and the rest of the migrations unapplied.

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

/** Strip comments and string literals so keyword matching cannot hit prose. */
function blank(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (c === "'") {
      i += 1
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2
        else if (sql[i] === "'") break
        else i += 1
      }
      i += 1
      out += "' '"
      continue
    }
    if (c === '$') {
      const tag = /^\$[a-z_]*\$/i.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        const stop = end === -1 ? sql.length : end
        // Keep the opening *and* the closing tag. Emitting only up to `stop`
        // silently drops the closer, and every later match against the tag then
        // fails — so the check quietly tests nothing and reports success. Which
        // is what it did the first time, and why it had to be verified against a
        // deliberately broken file rather than trusted.
        out += sql.slice(i, stop + tag[0].length)
        i = stop + tag[0].length
        continue
      }
    }
    out += c
    i += 1
  }
  return out
}

/** Keywords that only exist in a PL/pgSQL body. */
const PLPGSQL_ONLY = [
  { word: /\bdeclare\b/i, why: 'a variable block' },
  { word: /\bperform\b/i, why: 'the PERFORM statement' },
  { word: /\braise\s+(notice|exception|warning)/i, why: 'RAISE' },
  { word: /\breturn\s+next\b/i, why: 'RETURN NEXT' },
  { word: /\bexception\s+when\b/i, why: 'an exception handler' },
  { word: /\bexit\b/i, why: 'EXIT' },
  { word: /\bcontinue\b/i, why: 'CONTINUE' },
  { word: /\b\d+\s*;[\s\S]*?\binto\b/i, why: 'SELECT ... INTO' },
]

/**
 * A `->` / `->>` key must be a string, an expression, or a column — never a bare
 * table alias.
 *
 * `with ordinality as m(id, ord)` makes `m` a *row* and `m.id` its value, so
 * `card_map ->> m` is a `->>` with a record on the right and Postgres answers
 *
 *   42883  operator does not exist: jsonb ->> record
 *
 * which points at the operator rather than at the missing `.id`, and is only
 * visible by running the function. In this schema every key is a quoted literal
 * or a parenthesised expression, so a bare lowercase identifier after `->` /
 * `->>` is always a mistake.
 */
const SUSPECT_KEY = /->>?\s*([a-z_][a-z0-9_]*)(?![\w.])/gi

for (const file of files) {
  const sql = blank(fs.readFileSync(path.join(dir, file), 'utf8'))

  for (const m of sql.matchAll(SUSPECT_KEY)) {
    const key = m[1].toLowerCase()
    // Real identifiers that legitimately follow an operator: the `?`/`?|`/`?&`
    // containment operators take a column, and `-` is subtraction.
    if (['x', 'y', 'z', 'w'].includes(key)) continue
    fail(
      `${file}: \`->> ${key}\` uses a bare identifier as a JSON key. ` +
        `If "${key}" is a table alias use ${key}.column — a bare alias is a row, ` +
        `which Postgres reports as "jsonb ->> record".`,
    )
  }

  // Each `create [or replace] function … as $tag$ … $tag$;` block.
  const blocks = [
    ...sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+(\$[\w]*\$)([\s\S]*?)\4\s*;/gi,
    ),
  ]

  for (const [, name, args, header, , body] of blocks) {
    // `header` is everything between RETURNS and AS: the return type plus the
    // function's options, which is where `language` lives. Reading it from here
    // rather than by searching the file for the function's name is what makes
    // this reliable — an earlier version searched for the name's position, which
    // matched nothing, found no language, and so passed every single time.
    const language = /\blanguage\s+(\w+)/i.exec(header)?.[1]
    const returns = header.replace(/\blanguage\s+\w+/i, '').trim()
    const signature = `${name}(${args.replace(/\s+/g, ' ').trim()})`

    if (!language) {
      fail(`${file}: ${signature} declares no language`)
      continue
    }

    if (language.toLowerCase() !== 'sql') {
      // plpgsql and everything else: a body with declare/begin is expected.
      continue
    }

    // A `language sql` body must be a single query. Anything from this list
    // means the body is PL/pgSQL and the declaration is wrong.
    for (const { word, why } of PLPGSQL_ONLY) {
      if (word.test(body)) {
        fail(
          `${file}: ${signature} is \`language sql\` but its body uses ${why}. ` +
            `Change it to \`language plpgsql\`.`,
        )
      }
    }

    // The reverse mistake: a trigger function must be plpgsql, and a function
    // returning void with no body query is almost always a forgotten body.
    if (/^trigger$/i.test(returns.trim()) && /\bdeclare\b|\bbegin\b/i.test(body)) {
      fail(`${file}: ${signature} returns trigger but is \`language sql\``)
    }
  }
}

if (failures === 0) {
  console.log(`migration sql: ${files.length} files, every function body matches its declared language`)
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
