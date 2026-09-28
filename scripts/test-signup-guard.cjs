// Prove scripts/test-signup.cjs fails on the bugs it was written for.
//
// A test that has never been seen to fail might not be checking anything. The bug
// that shipped was a hard-coded primary key on the welcome page, so that is what
// goes back in, and the test has to notice.
//
// Two re-breakings, because migration 9 makes two separate guarantees and a test
// that only covers one of them is worth less than it looks:
//
//   1. the hard-coded page id   -> the bug that actually shipped, and the reason
//                                  the second account could not exist
//   2. the non-fatal guard      -> the reason the next such bug cannot make the
//                                  product unusable again even if it happens
//
// Each break reverts one hunk of migration 9, re-runs the whole test -- which
// rebuilds the schema from all nine files and signs two people up -- and then puts
// the file back. Migration 9 is restored in a `finally`, so a failure here leaves
// the repository correct rather than sabotaged.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const CONTAINER = 'map204-signup-test'
const MIGRATION_9 = path.join(__dirname, '..', 'supabase', 'migrations', '20261001000009_second_account_can_sign_up.sql')
const TEST = path.join(__dirname, 'test-signup.cjs')

const original = fs.readFileSync(MIGRATION_9, 'utf8')

const runTest = () =>
  execFileSync(process.execPath, [TEST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const removeContainer = () => {
  try {
    execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' })
  } catch {
    /* not running */
  }
}

const BREAKS = [
  {
    label: 'the hard-coded page id — the bug that shipped',
    from: `  second_page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
                    || '_' || substr(md5(random()::text), 1, 6);`,
    to: `  second_page_id := 'page_tutorial_maps';`,
    /*
     * With the non-fatal guard in place -- which is the shipped state -- this does
     * NOT fail the signup. The collision is caught, warned about, and the account is
     * created with no welcome workspace. So the symptom is a *missing workspace*,
     * not a refused sign-up, and that is the right thing to look for: the guard
     * works, and the count assertion is what notices.
     *
     * Checked rather than assumed, so a failure for some unrelated reason is not
     * counted as a success here.
     */
    expect: 'the second account got',
  },
  {
    label: 'the non-fatal guard removed — signup aborts on any failure again',
    from: `  begin
    perform public.create_tutorial_workspace(new.id);
  exception when others then
    raise warning
      'the welcome workspace for % could not be created (%); the account was created anyway',
      new.id, sqlerrm;
  end;`,
    to: `  perform public.create_tutorial_workspace(new.id);`,
    // With the guard gone this break is inert on its own -- a minted id never
    // collides -- so the hard-coded id is put back as well. The two together are
    // exactly the shipped bug, and the symptom is the reported one: the second
    // person cannot be created at all.
    expect: 'sign-in failed',
  },
]

let caught = 0
let checked = 0

for (const brk of BREAKS) {
  if (!original.includes(brk.from)) {
    console.log(`SKIP  ${brk.label}\n      the text to revert is not in migration 9 -- it has moved`)
    continue
  }

  checked += 1
  let broken = original.replace(brk.from, brk.to)

  // The second break needs both halves to mean anything: with the guard gone *and*
  // the id hard-coded, the first signup fails. Alone, either one is survivable.
  if (brk.label.includes('non-fatal')) {
    broken = broken.replace(
      `  second_page_id := 'page_' || floor(extract(epoch from now()) * 1000)::text
                    || '_' || substr(md5(random()::text), 1, 6);`,
      `  second_page_id := 'page_tutorial_maps';`,
    )
  }

  fs.writeFileSync(MIGRATION_9, broken, 'utf8')

  try {
    removeContainer()
    try {
      runTest()
      console.log(`  ${brk.label}\n      PASSED -- the test does NOT cover this`)
    } catch (error) {
      const out = String(error.stdout || '') + String(error.stderr || '')
      const first = out.split('\n').find((l) => l.startsWith('FAIL')) || ''
      const rightReason = out.includes(brk.expect)
      console.log(`  ${brk.label}\n      ${rightReason ? 'failed as it should' : 'FAILED, but not for this reason'}`)
      if (first) console.log(`      ${first.trim().slice(0, 150)}`)
      if (rightReason) caught += 1
    }
  } finally {
    fs.writeFileSync(MIGRATION_9, original, 'utf8')
  }
}

removeContainer()

console.log(`\n${caught} of ${checked} deliberate re-breakings were caught.`)
console.log('migration 9 restored.')
process.exit(caught === checked && checked > 0 ? 0 : 1)
