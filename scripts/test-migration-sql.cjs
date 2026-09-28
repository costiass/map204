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
//
// ---------------------------------------------------------------------------
// The second check is quieter and worse: that the functions the client calls read
// the *current* shape of the data. import_pages read its page contents from
// page -> \'cards\' after the client had begun sending elements, and coalesce\n// turned the absence into an empty array. Every import succeeded and produced
// blank pages — a transaction, a row count and a fresh read-back all passed,
// because the only thing wrong was the contents and nobody looked at them.
//
// A syntactically perfect function reading the wrong key is invisible to every
// other tool in this repo, so it is checked here.

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
        //
        // The body is kept because it is what has to be inspected, but its
        // comments are not: a comment explaining the `jsonb ->> record` mistake
        // is prose, and reading it as code reports a bug that is not there.
        out += tag[0] + blank(sql.slice(i + tag[0].length, stop)) + tag[0]
        i = stop + tag[0].length
        continue
      }
    }
    out += c
    i += 1
  }
  return out
}

/**
 * A parameter list reduced to its types, so two declarations of the same function
 * can be compared.
 *
 * Names are dropped — `p_document_id` is not part of the identity — and so is
 * spacing and case. What is left is exactly what Postgres keys on.
 *
 * A comma inside a type's parentheses (`numeric(10,2)`) must not be read as a
 * parameter boundary, so the split is on top-level commas only. Nothing in this
 * schema uses such a type today; if something did, splitting naively would
 * produce a signature that never matches and hide a real overload.
 */
function normalizeParams(list) {
  const parts = []
  let depth = 0
  let current = ''
  for (const c of list) {
    if (c === '(') depth += 1
    if (c === ')') depth -= 1
    if (c === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += c
  }
  parts.push(current)

  return parts
    .map((part) =>
      part
        .trim()
        // Drop `default <expr>`: the default is part of the call, not the type.
        .replace(/\s+default\s+[\s\S]*$/i, '')
        .replace(/\s+/g, ' ')
        .toLowerCase(),
    )
    .filter(Boolean)
    /*
     * Drop the parameter *name*.
     *
     * `create` names its parameters and `drop` need not, so the same function is
     * written `(p_document_id uuid, p_pages jsonb)` in one statement and
     * `(uuid, jsonb)` in the other. Postgres keys on the types alone, so the
     * comparison has to as well — otherwise the drop misses the function it names
     * and the check reports an overload that was removed two lines earlier.
     *
     * A lone token is already a type; two or more means the first is the name.
     */
    .map((part) => (part.split(' ').length > 1 ? part.split(' ').slice(1).join(' ') : part))
    .join(',')
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

/**
 * The file holding the *last* `create or replace` for a function.
 *
 * A `create or replace` chain means the newest body wins and an older one is
 * history rather than a bug. Checking every definition would make this test fail
 * on the very migration that fixes the problem — which is how a useful check
 * gets deleted by the person it was meant to help.
 *
 * Computed from file order, which is the order the migrations run in.
 */
const lastDefinitionOf = (function () {
  const byName = new Map()
  for (const file of files) {
    const sql = blank(fs.readFileSync(path.join(dir, file), 'utf8'))
    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi,
    )) {
      byName.set(m[1].toLowerCase(), file)
    }
  }
  return (name) => byName.get(String(name).toLowerCase())
})()

/**
 * Overloaded function names: at most one live signature each.
 *
 * A function's identity is its name *and* its parameter types. So
 * `create or replace function f(a text)` followed by
 * `create or replace function f(a uuid)` does not update `f` — it leaves both of
 * them alive under one name. Nothing errors. The schema is valid, the SQL is
 * valid, and the function works if you call it with a cast.
 *
 * PostgREST then refuses, because a name it cannot resolve to one function is not
 * a name it will guess at:
 *
 *   PGRST203 Could not choose the best candidate function between:
 *     public.import_pages(p_document_id => text, p_pages => jsonb),
 *     public.import_pages(p_document_id => uuid, p_pages => jsonb)
 *
 * and that is the whole RPC. Importing a document stops working, from a cause
 * three files and two commits away from the edit that caused it.
 *
 * This walks the migrations in the order they run, tracking what is alive:
 * `create`/`create or replace` adds or overwrites one signature, `drop function`
 * removes one. A name with more than one live signature at the end is overloaded.
 *
 * It is a general invariant rather than a rule about `import_pages`, because the
 * trap is general: changing a parameter's type is a change of *name*, and the
 * person who wrote it was editing a body.
 */
{
  // Lowercased `name -> Set<signature>`, plus where each signature came from, so a
  // failure can name the file to look at.
  const live = new Map()

  const addLive = (name, signature, file) => {
    const key = name.toLowerCase()
    if (!live.has(key)) live.set(key, new Map())
    // A `create or replace` on an identical signature overwrites in place; either
    // way the signature is the same string, so this is just bookkeeping.
    live.get(key).set(signature, file)
  }

  for (const file of files) {
    const sql = blank(fs.readFileSync(path.join(dir, file), 'utf8'))

    for (const m of sql.matchAll(
      /drop\s+function\s+(?:if\s+exists\s+)?([\w.]+)\s*\(([\s\S]*?)\)/gi,
    )) {
      const key = m[1].toLowerCase()
      if (!live.has(key)) continue
      const signature = normalizeParams(m[2])
      // A drop with no argument list, or one naming a signature that is not
      // there, is not an error here — `drop function if exists` is allowed to
      // miss. Only an exact hit removes something.
      live.get(key).delete(signature)
      if (live.get(key).size === 0) live.delete(key)
    }

    for (const m of sql.matchAll(
      /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns/gi,
    )) {
      addLive(m[1], normalizeParams(m[2]), file)
    }
  }

  for (const [name, signatures] of live) {
    if (signatures.size <= 1) continue
    const detail = [...signatures]
      .map(([signature, file]) => `  (${signature || 'no arguments'})  introduced by ${file}`)
      .join('\n')
    fail(
      '`' +
        name +
        '` is overloaded: ' +
        signatures.size +
        ' signatures are live at once.\n' +
        detail +
        '\n  PostgREST resolves an RPC by name and cannot choose between them, ' +
        'so every call fails with PGRST203. A "create or replace" whose ' +
        'parameter types differ does not replace - it adds. Drop the old one ' +
        'first: drop function ' +
        name +
        '(<old types>);',
    )
  }
}

for (const file of files) {
  // `rawSql` keeps string literals and comments; `sql` is the blanked version the
  // language and `->>` checks read. Two views of one file, because a check for a
  // missing key needs the key, and a check for a `jsonb ->> record` mistake needs
  // the key erased.
  const rawSql = fs.readFileSync(path.join(dir, file), 'utf8')
  const sql = blank(rawSql)

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

    // ----------------------------------------------------------------
    // A function the browser calls has to read the *current* shape of the
    // data it is given.
    //
    // `import_pages` is a security-definer RPC that takes a whole document and
    // reads its contents by key. When the client stopped sending `cards` and
    // began sending `elements`, that key went missing, `coalesce` turned the
    // absence into an empty array, and every import inserted blank pages while
    // reporting success — a transaction, a row count and a fresh read-back all
    // passed, because the only thing wrong was the contents and nothing looked
    // at them.
    //
    // A syntactically perfect function reading the wrong key is invisible to
    // every other tool in this repo, so it is asserted here.
    //
    // The assertion is narrow on purpose: the function must read `elements`.
    // Reading `cards` as well is correct and expected, because a version 1 file
    // is exactly what somebody has lying around.
    // Only the *last* definition of a function is the one that runs; an earlier
    // one is superseded by its own `create or replace`. Checking every definition
    // would fail on the very migration that fixes the problem, which is how a
    // useful check gets deleted.
    // Only the *last* definition of a function is the one that runs; an earlier
    // one is superseded by its own `create or replace`. Checking every definition
    // would fail on the very migration that fixes the problem, which is how a
    // useful check gets deleted.
    //
    // Tested against the *raw* file, not `body`. `blank()` replaces every string
    // literal with a space — which is right for finding a `->> record` mistake
    // and exactly wrong here, because the thing being looked for *is* a string
    // literal. The first version of this check tested the blanked body, matched
    // nothing, and reported the broken function as fixed.
    if (name.toLowerCase().endsWith('import_pages') && lastDefinitionOf(name) === file) {
      if (!/->\s*'elements'/.test(rawSql)) {
        fail(
          `${file}: ${signature} does not read \`page -> 'elements'\`. The client ` +
            'sends a version 2 document, so every import will insert empty pages ' +
            "and report success. Read both 'elements' and 'cards'.",
        )
      }
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

// --- the functions the client calls must read the current shape ----------

// --- the last definition of a function is the one that counts ----------
//
// A create or replace chain means the body in the last file wins, and an
// earlier one is history rather than a bug. Checking every definition would
// make this test fail on the very migration that fixes the problem, which is
// how a useful check gets deleted.
const lastDefinition = new Map()
for (const file of files) {
  const sql = blank(fs.readFileSync(path.join(dir, file), 'utf8'))
  for (const m of sql.matchAll(
    /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi,
  )) {
    lastDefinition.set(m[1].toLowerCase(), file)
  }
}

if (failures === 0) {
  console.log(
    `migration sql: ${files.length} files, every function body matches its declared ` +
      'language, and every function the client calls reads the current shape',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
