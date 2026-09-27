globalThis.localStorage = {
  store: new Map(),
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null
  },
  setItem(key, value) {
    this.store.set(key, String(value))
  },
  removeItem(key) {
    this.store.delete(key)
  },
  clear() {
    this.store.clear()
  },
}

globalThis.window = globalThis
globalThis.innerWidth = 1440
globalThis.innerHeight = 900
globalThis.matchMedia ??= () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
})

const { checkCollapsedLinks, checkDatabase, checkDefaults, checkGeometry, checkLegacyMigration, checkMarkdown, checkRender, checkSerialization, checkStore } =
  await import('../dist-ssr/smoke.js')

const groups = [
  ['render', checkRender],
  ['markdown', checkMarkdown],
  ['legacy migration', checkLegacyMigration],
  ['serialization', checkSerialization],
  ['geometry', checkGeometry],
  ['store', checkStore],
  ['default styles', checkDefaults],
  ['collapsed links', checkCollapsedLinks],
  ['storage', checkDatabase],
]

let failed = 0
for (const [name, run] of groups) {
  console.log(`\n${name}`)
  for (const check of await run()) {
    if (!check.ok) failed += 1
    const detail = check.detail ? `  (${check.detail})` : ''
    console.log(`  ${check.ok ? 'PASS' : 'FAIL'}  ${check.label}${detail}`)
  }
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)

