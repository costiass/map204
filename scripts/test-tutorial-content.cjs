// A cheap structural check for the tutorial migration.
//
// The content is hand-written JSONB, so the failure mode is a missing comma or
// an unbalanced paren — neither of which `tsc` or `oxlint` can see, and both of
// which only surface when the migration runs against a live database. This
// catches them at commit time instead.

const fs = require('fs')

// The content functions live in 006; the trigger that installs them, and the two
// page titles, are in 005. Both are read, because "the tutorial demonstrates X"
// is a claim about the pair — a complete function nobody calls teaches nobody
// anything.
const sql = [
  'supabase/migrations/20261001000005_app_functions.sql',
  'supabase/migrations/20261001000006_tutorial_content.sql',
]
  .map((name) => fs.readFileSync(name, 'utf8'))
  .join('\n')

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

// 1. Parens balance, ignoring anything inside a string literal or a comment.
let depth = 0
let inString = false
let inLineComment = false
let inBlockComment = false
for (let i = 0; i < sql.length; i += 1) {
  const c = sql[i]
  const next = sql[i + 1]
  if (inLineComment) {
    if (c === '\n') inLineComment = false
    continue
  }
  if (inBlockComment) {
    if (c === '*' && next === '/') {
      inBlockComment = false
      i += 1
    }
    continue
  }
  if (inString) {
    if (c === "'") {
      // '' is an escaped quote, not the end of the string.
      if (next === "'") i += 1
      else inString = false
    }
    continue
  }
  if (c === '-' && next === '-') {
    inLineComment = true
    i += 1
    continue
  }
  if (c === '/' && next === '*') {
    inBlockComment = true
    i += 1
    continue
  }
  if (c === "'") inString = true
  else if (c === '(') depth += 1
  else if (c === ')') depth -= 1
  if (depth < 0) {
    fail(`unbalanced ")" at offset ${i}`)
    break
  }
}
if (depth !== 0) fail(`parentheses end at depth ${depth}, expected 0`)
if (inString) fail('a string literal is left open')

// 2. The `key: value` typo. Inside a jsonb_build_object the arguments are
//    positional, so a colon where a comma belongs is a syntax error.
const colonLines = sql
  .split('\n')
  .map((line, index) => ({ line, number: index + 1 }))
  .filter(({ line }) => /'[^']*'\s*:\s/.test(line))
if (colonLines.length > 0) {
  for (const { line, number } of colonLines) fail(`line ${number} uses ':' between arguments: ${line.trim()}`)
}

// 3. Every jsonb_build_object argument must alternate key, value. A key is a
//    single-quoted literal, a value is anything else.
const calls = [...sql.matchAll(/jsonb_build_object\(([\s\S]*?)\)\s*(?=,|\))/g)]
for (const [, body] of calls) {
  // Split on commas that are not inside a string or a nested paren.
  const args = []
  let current = ''
  let d = 0
  let str = false
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i]
    if (str) {
      current += c
      if (c === "'") {
        if (body[i + 1] === "'") {
          current += body[i + 1]
          i += 1
        } else str = false
      }
      continue
    }
    if (c === "'") {
      str = true
      current += c
      continue
    }
    if (c === '(' || c === '[') d += 1
    if (c === ')' || c === ']') d -= 1
    if (c === ',' && d === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  if (current.trim()) args.push(current.trim())

  if (args.length % 2 !== 0) {
    fail(`jsonb_build_object has ${args.length} arguments (odd): ${body.trim().slice(0, 80)}`)
    continue
  }
  for (let i = 0; i < args.length; i += 2) {
    if (!/^'[^']*'$/.test(args[i])) {
      fail(`argument ${i + 1} of jsonb_build_object is not a quoted key: ${args[i]}`)
    }
  }
}

// 4. Content coverage: the point of the tutorial is that it exercises the model,
//    so assert the parts that are easy to drop in an edit.
const expect = [
  ['two pages', /'Start here'/],
  ["page 2 exists", /'Making maps'/],
  ['a group', /tut_group_evidence/],
  ['a group-to-card link', /'kind', 'group'/],
  ['a checklist', /'checklist', jsonb_build_array\(\s*\n?\s*jsonb_build_object\('id', 'tut2_task_g1'/],
  ['a dashed link', /'dashed'/],
  ['a dotted link', /'dotted'/],
  ['a stepped link', /'stepped'/],
  ['a contradicts link', /'contradicts'/],
  ['a part-of link', /'part of'/],
  ['arrowhead variety', /'triangle'/],
]
for (const [label, pattern] of expect) {
  if (!pattern.test(sql)) fail(`tutorial no longer demonstrates: ${label}`)
}

if (failures === 0) {
  console.log('tutorial migration: structure OK')
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
