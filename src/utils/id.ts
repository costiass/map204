/** Collision-resistant, human-readable ids. Never use array indexes as ids. */
let counter = 0

export function createId(prefix: string): string {
  counter += 1
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${time}${counter.toString(36)}${rand}`
}

/** Deep clone that is safe for the plain-JSON document. */
export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function uid(prefix: string): string {
  return createId(prefix)
}
