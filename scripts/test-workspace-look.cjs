// Guards the three places a workspace's colour and icon are enumerated.
//
//   1. src/theme.ts                     â€” what the app offers
//   2. the database check constraints    â€” what the server will accept
//   3. supabase/functions/â€¦/_workspace_look.ts â€” what the email describes
//
// Three hand-written lists for one concept is three chances to disagree, and the
// failure is silent: a value the app offers but the database rejects shows up
// as a save error with no explanation, and a value the email does not know
// renders as a colour nobody chose. So they are compared here instead.

const fs = require('fs')

const theme = fs.readFileSync('src/theme.ts', 'utf8')
const edge = fs.readFileSync('supabase/functions/send-share-email/_workspace_look.ts', 'utf8')
const migration = fs.readFileSync(
  'supabase/migrations/20261001000001_schema.sql',
  'utf8',
)

let failures = 0
const fail = (message) => {
  console.log(`FAIL  ${message}`)
  failures += 1
}

const between = (text, start, end) => {
  const from = text.indexOf(start)
  const to = text.indexOf(end, from + 1)
  if (from === -1 || to === -1) return ''
  return text.slice(from, to)
}

/* ---- accents --------------------------------------------------------- */

// The workspace accent list in the theme: the `ACCENTS` array, plus the neutral
// `slate` that only workspaces use. Scoped to `ACCENTS` deliberately â€” a naive
// scan of the file also picks up the *palettes*, which are a different concept
// with their own ids, and comparing those against the database is meaningless.
const accentBlock = between(theme, 'export const WORKSPACE_ACCENTS', 'export const DEFAULT_WORKSPACE_ACCENT')
const userAccents = between(theme, 'export const ACCENTS: Accent[]', 'export const DEFAULT_ACCENT')
const themeAccents = new Set(
  [...userAccents.matchAll(/\{\s*id: '([a-z]+)',\s*label:/g)].map((m) => m[1]),
)
if (themeAccents.size < 7) {
  fail(`expected the user accent list to be populated, found ${themeAccents.size}: ${[...themeAccents]}`)
}
if (!accentBlock.includes('SLATE')) {
  fail('WORKSPACE_ACCENTS should include the neutral SLATE entry')
}
themeAccents.add('slate')

// The check constraint in the migration.
/**
 * The allowed values for a check constraint, wherever it is declared.
 *
 * The constraint is written inline in the `create table` — that is where it
 * belongs, since a table with a constraint nobody reads is a table that invites
 * a later `alter table … drop constraint` to weaken it quietly. An earlier
 * version of this schema declared them separately, so both forms are accepted
 * rather than the test hard-coding one.
 */
function checkValues(text, name) {
  const inline = new RegExp(
    `constraint\\s+${name}\\s+check\\s*\\(([\\s\\S]*?)\\n\\s*\\)`,
    'i',
  ).exec(text)
  if (inline) {
    return new Set([...inline[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
  }
  const separate = new RegExp(
    `${name}\\s*\\n?\\s*check\\s*\\(([\\s\\S]*?)\\n\\s*\\)`,
    'i',
  ).exec(text)
  if (separate) {
    return new Set([...separate[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
  }
  return new Set()
}

const accentCheck = checkValues(migration, 'documents_accent_check')
const dbAccents = new Set(
  [...accentCheck].map((v) => v),
)
for (const id of themeAccents) {
  if (!dbAccents.has(id)) fail(`database rejects accent '${id}', which the app offers`)
}
for (const id of dbAccents) {
  if (!themeAccents.has(id)) fail(`database allows accent '${id}', which the app cannot draw`)
}

// The Edge Function's copy, by hex.
const edgeAccentBlock = between(edge, 'WORKSPACE_ACCENT_HEX', '/** Icon id')
const edgeAccents = new Set(
  [...edgeAccentBlock.matchAll(/^\s*([a-z]+):\s*'#/gm)].map((m) => m[1]),
)
for (const id of themeAccents) {
  if (!edgeAccents.has(id)) fail(`the share email does not know accent '${id}'`)
}
for (const id of edgeAccents) {
  if (!themeAccents.has(id)) fail(`the share email knows accent '${id}', which the app cannot draw`)
}

// The hex values must match too, or the email names a different colour than the
// workspace it is describing.
// The hex for each accent. `id: 'slate' as AccentId` carries a cast, so the
// pattern has to tolerate one â€” SLATE is declared in its own block.
const accentSource = `${userAccents}\n${between(theme, 'const SLATE: Accent', 'export const WORKSPACE_ACCENTS')}`
for (const [, id, hex] of accentSource.matchAll(
  /id: '([a-z]+)'(?: as \w+)?,\s*label: '[^']*',\s*base: '(#[0-9a-f]{6})'/g,
)) {
  const found = edgeAccentBlock.match(new RegExp(`\\b${id}:\\s*'(#[0-9a-f]{6})'`))
  if (!found) {
    if (themeAccents.has(id)) fail(`the share email is missing a hex for accent '${id}'`)
    continue
  }
  if (found[1].toLowerCase() !== hex.toLowerCase()) {
    fail(`accent '${id}' is ${hex} in the app but ${found[1]} in the email`)
  }
}

/* ---- icons ----------------------------------------------------------- */

const themeIcons = new Set(
  [...between(theme, 'export const WORKSPACE_ICONS', 'export const DEFAULT_WORKSPACE_ICON').matchAll(
    /\{\s*id: '([a-z-]+)',\s*label: '([^']+)'/g,
  )].map((m) => m[1]),
)
if (themeIcons.size < 8) fail(`expected the icon list to be populated, found ${themeIcons.size}`)

const iconCheck = checkValues(migration, 'documents_icon_check')
const dbIcons = new Set([...iconCheck])
for (const id of themeIcons) {
  if (!dbIcons.has(id)) fail(`database rejects icon '${id}', which the app offers`)
}
for (const id of dbIcons) {
  if (!themeIcons.has(id)) fail(`database allows icon '${id}', which the app cannot draw`)
}

const edgeIconBlock = between(edge, 'ICON_LABELS', '\n}')
const edgeIcons = new Set(
  [...edgeIconBlock.matchAll(/^\s*'?([a-z-]+)'?:\s*'/gm)].map((m) => m[1]),
)
for (const id of themeIcons) {
  if (!edgeIcons.has(id)) fail(`the share email does not know icon '${id}'`)
}

// Labels, so the email does not call a workspace "Course" when the list says
// "Course" but the function says something else.
const themeLabels = new Map(
  [...between(theme, 'export const WORKSPACE_ICONS', 'export const DEFAULT_WORKSPACE_ICON').matchAll(
    /\{\s*id: '([a-z-]+)',\s*label: '([^']+)'/g,
  )].map((m) => [m[1], m[2]]),
)
for (const [id, label] of themeLabels) {
  const found = edgeIconBlock.match(new RegExp(`'?${id}'?:\\s*'([^']+)'`))
  if (!found) continue
  if (found[1] !== label) {
    fail(`icon '${id}' is labelled '${label}' in the app but '${found[1]}' in the email`)
  }
}

/* ---- the app's own fallback ------------------------------------------ */

// WorkspaceMark maps every stored icon to a lucide component. An id the theme
// offers but the component cannot draw renders as an empty box. The keys are
// quoted, because most of the icon names contain a dash.
const mark = fs.readFileSync('src/components/WorkspaceMark.tsx', 'utf8')
const markIcons = new Set(
  [...between(mark, 'const ICONS: Record<string, LucideIcon>', 'export interface WorkspaceMarkProps').matchAll(
    /'?([a-z-]+)'?:\s*[A-Z]/g,
  )].map((m) => m[1]),
)
for (const id of themeIcons) {
  if (!markIcons.has(id)) fail(`WorkspaceMark cannot draw the icon '${id}'`)
}

if (failures === 0) {
  console.log('workspace look: theme, database and email agree')
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
