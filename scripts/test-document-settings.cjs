// Prove the per-workspace settings file does what it is for.
//
// Three things have to be true, and each was a way this could quietly not work:
//
//   1. It is the reader's, not the workspace's. Two people in one map must not be
//      able to see, overwrite, or be overwritten by each other's camera.
//   2. It travels with the person. `localStorage` is per device, which is why the
//      camera used to be different on a phone and a laptop.
//   3. It is still not the document. The camera was once a column on `pages` and was
//      broadcast, and both were wrong: whoever opened a map last decided where
//      everybody else started.
//
// The third is the one a static check is worst at, so most of what follows is about
// the *absence* of a connection: no column, no broadcast, no signature.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

let failures = 0
let checked = 0
const fail = (m) => {
  console.log(`FAIL  ${m}`)
  failures += 1
}

const migration = read('supabase/migrations/20261001000013_user_document_settings.sql')
const sync = read('src/hooks/usePageSync.ts')
const store = read('src/store/useCanvasStore.ts')
const settings = read('src/store/documentSettings.ts')
const viewport = read('src/store/viewportStore.ts')
const dbSync = read('src/store/supabase-sync.ts')

/*
 * Three bodies, each taken from its own declaration rather than from the first
 * mention of a word.
 *
 * This is the third time a window between two words has produced a wrong answer in
 * this project, and the third time the shape was the problem: a slice from a call
 * site reads as though it were a definition, and then reports on the wrong code.
 * So each of these is anchored on something that can only appear once, and if the
 * anchor is missing the test says it cannot tell rather than passing.
 */
function bodyBetween(text, from, to, label) {
  const start = text.indexOf(from)
  if (start < 0) return null
  const end = text.indexOf(to, start)
  if (end < 0) return null
  return text.slice(start, end)
}

/*
 * Everything below reads *code*, not text.
 *
 * Three attempts at slicing a function body out of a file all failed in the same
 * way: the slice was anchored on a word that appears more than once, so it read a
 * call site instead of a definition, or a SELECT instead of an UPDATE, and a slice
 * that finds nothing trivially contains no forbidden word. Every one of those
 * reported success on code it had not looked at.
 *
 * So: strip the comments, then assert over the whole file. A whole-file assertion
 * cannot pick the wrong occurrence, and stripping the comments is what keeps the
 * *explanations* -- several of which are long and several of which name the very
 * thing being forbidden -- from being read as the thing itself.
 */
function codeOnly(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

const syncCode = codeOnly(sync)
const storeCode = codeOnly(store)
const dbSyncCode = codeOnly(dbSync)
const settingsCode = codeOnly(settings)

const payloadBody = bodyBetween(syncCode, 'const payload:', 'void channelRef', 'page-update payload')
const signatureBody = bodyBetween(syncCode, 'function pageSignature(', '\n}', 'pageSignature')

/* 1. One person, one workspace ------------------------------------------------ */

checked += 1
if (!/primary key \(user_id, document_id\)/.test(migration)) {
  fail(
    'the settings table has no composite key on (user_id, document_id). Without it two ' +
      "people's settings for one workspace collide, and the second person to open it " +
      'overwrites the first -- which is the exact bug the table exists to prevent.',
  )
}

/* 2. Nobody can read or write anybody else's ---------------------------------- */

checked += 1
{
  // Every policy, one by one. A count would pass on three correct and one missing.
  const policies = [...migration.matchAll(/create policy\s+"?([\w ]+)"?\s+on[\s\S]*?;/g)]
  if (policies.length < 4) {
    fail(
      `only ${policies.length} policies were found on user_document_settings; a row that ` +
        'can be inserted but not updated, or read but not deleted, is half a feature.',
    )
  }

  for (const policy of policies) {
    // The `user_id = auth.uid()` test has to be in every one. `can_view_document`
    // is deliberately absent from the write side, and that is reasoned in the
    // migration -- but `auth.uid()` has to be in all of them.
    if (!/user_id\s*=\s*auth\.uid\(\)/.test(policy[0])) {
      fail(
        `the "${policy[1].trim()}" policy does not test user_id = auth.uid(). Without it ` +
          'one account can read or overwrite another account\'s camera for a workspace ' +
          'they share.',
      )
    }
  }
}

/* 3. The camera still is not the document -------------------------------------- */

checked += 1
{
  // It was here once, and it was wrong. These are the three things that have to stay
  // gone, and each is a distinct way of putting the camera back in shared state.
  if (payloadBody && /\bviewport\b/i.test(payloadBody)) {
    fail(
      'the viewport is back in the page broadcast payload. Two people in one map have ' +
        'two cameras, and broadcasting one makes whoever moved last drag the other ' +
        "around. It was removed for this reason.",
    )
  }

  if (!signatureBody) {
    fail('could not find pageSignature at all, so this check cannot say anything.')
  } else if (/viewport/i.test(signatureBody)) {
    fail(
      'the viewport is back in pageSignature, so panning counts as an edit again. Every ' +
        'wheel tick would queue a save and tell the room about a camera that is nobody ' +
        "else's business.",
    )
  }

  // Only the *writes*, not the whole file.
  //
  // The whole-file version of this reported a failure, correctly, for a file that was
  // doing nothing wrong: the `Viewport` type, the default constant, and a read of
  // `row.viewport` that hydrates a legacy row somebody else's old build wrote. Those
  // are all fine, and a check that cannot tell them from a write is not usable.
  //
  // So the assertion is on what goes *out*: no `.update(`, `.insert(` or `.upsert(`
  // call may name the camera. That is the boundary it is actually about.
  //
  // The object literal is matched up to its *first* closing brace, not to the first
  // `)` -- a non-greedy `\)` spans from one call's opening paren to a later call's
  // closing paren, which swallowed the `row.viewport` read in between and made a
  // correct file look wrong.
  const writes = [...dbSyncCode.matchAll(/\.(?:update|insert|upsert)\(\{[\s\S]*?\n\s*\}/g)].map(
    (m) => m[0],
  )
  if (writes.some((w) => /\bviewport\b/i.test(w))) {
    fail(
      'the camera is being written to the database again. The camera is not part of ' +
        'the document, and writing it made panning count as an edit, so the last ' +
        'person to open a map decided where the next one started.',
    )
  }
}

/* 4. And it travels with the person, not the device --------------------------- */

checked += 1
{
  // Both copies, deliberately: the browser so the canvas can draw on the first
  // frame, the file so the next device agrees. Losing the file is the regression --
  // that is the bug being fixed.
  if (!/recallViewport/.test(settings)) {
    fail(
      'the settings file is written but the browser cache is not updated, so a map can ' +
        'open on one camera and save another.',
    )
  }

  if (!/setCameraSink/.test(viewport) || !/cameraSink\?\./.test(viewport)) {
    fail(
      'the canvas store no longer hands camera moves to the settings file. The file is ' +
        'then only written when something else remembers to, which is nothing.',
    )
  }

  // And the canvas store must not have reached in the other direction: importing a
  // Supabase-backed module into it breaks every bundle that builds it without
  // VITE_SUPABASE_URL, which is how this was done the first time.
  //
  // Comments stripped first. The file *explains* at length why it must not import
  // these, and it names all three in the explanation -- so a scan of the raw text
  // finds exactly what it is forbidden to find. That is a check reporting on prose.
  const storeCode = store.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
  const canvasImports = [...storeCode.matchAll(/^import .*from '([^']+)'/gm)].map((m) => m[1])
  for (const bad of ['@/lib/supabase', '@/store/documentSettings', '@/store/userSettings']) {
    if (canvasImports.includes(bad)) {
      fail(
        `the canvas store imports ${bad}, which reaches \`import.meta.env\` at load time. ` +
          'Every bundle that builds the store without VITE_SUPABASE_URL -- including the ' +
          "one test-read-only.cjs makes -- then fails with \"Cannot read properties of " +
          "undefined\". The camera is handed out through setCameraSink instead.",
      )
    }
  }
}

/* 5. Defaults are recorded on arrival ---------------------------------------- */

checked += 1
if (!/if \(settings\.defaults\) return/.test(settings)) {
  fail(
    'the settings file does not skip seeding when it already has defaults, so every open ' +
      'would overwrite the snapshot with whatever the person looks like now. The point of ' +
      'it is the appearance they arrived with.',
  )
}

if (!/applyDocumentSettings/.test(read('src/App.tsx'))) {
  fail(
    'opening a workspace never reads the settings file, so the map always opens at the ' +
      'default view however the person left it.',
  )
}

/* 6. The stored document is not trusted -------------------------------------- */

checked += 1
{
  // It is a jsonb column any client can write, and the zoom bounds are what stop a
  // hand-edited value from becoming a canvas that cannot be drawn.
  if (!/MIN_ZOOM/.test(settings) || !/MAX_ZOOM/.test(settings)) {
    fail(
      'the stored camera is not bounds-checked. A zoom of 0 is not a wrong view, it is a ' +
        'canvas that cannot be drawn, and the file is a jsonb column any client can write.',
    )
  }

  if (!/version\s*>\s*SETTINGS_VERSION/.test(settingsCode)) {
    fail(
      'a settings file written by a newer build is not refused. Reading a shape this ' +
        'build does not know means reading a field for the wrong thing, and writing it ' +
        "back destroys whatever the newer build put there.",
    )
  }
}

/* 7. The broadcast payload, taken from its own declaration ------------------- */

checked += 1
if (!payloadBody) {
  fail('could not find the page-update payload, so this check cannot say anything.')
}

if (failures === 0) {
  console.log(
    `workspace settings: ${checked} checks -- one file per person per workspace, only ` +
      'readable by its owner, still not part of the document, following the person ' +
      'between devices, and not trusted on the way back in.',
  )
} else {
  console.log(`\n${failures} check(s) failed.`)
  process.exit(1)
}
