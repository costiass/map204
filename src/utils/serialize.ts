/**
 * Reading and writing a document file.
 *
 * Thin on purpose. The v2 library — `elements/serialize` for the shape,
 * `elements/migrate` for older versions — already guarantees the document is
 * valid. What is left here is the part that is genuinely about *files*: parsing
 * text, and handing a blob to the browser.
 *
 * The interesting decision is that import is a *migration*, not a
 * normalisation. A v1 file has no element kinds, so reading one means deciding
 * what each old card became — which is a judgement with a report attached
 * (`warnings`), not a silent coercion. `migrateToV2` is where that happens.
 */

import {
  normalizeDoc as normalizeV2,
  serializeDoc as serializeV2,
  type CanvasDocV2,
} from '@/elements/serialize'
import { migrateToV2, type MigrationResult } from '@/elements/migrate'

export type { CanvasDocV2 as CanvasDoc }

/** A document plus anything the reader had to give up to build it. */
export interface ParseResult {
  doc: CanvasDocV2
  /** What the migration did, in order. Empty for a clean v2 file. */
  notes: string[]
  /** Things that could not be translated. Never swallowed. */
  warnings: string[]
}

/**
 * Parse a document file of any supported version.
 *
 * @throws if the text is not JSON, or is not a document object at all. Those are
 * the two failures where continuing would produce a plausible-looking empty map,
 * which is worse than an error.
 */
export function parseDoc(text: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON: ${message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('File does not contain a Map204 document object.')
  }

  const migrated: MigrationResult = migrateToV2(parsed)
  return {
    // Normalised after migrating, so a hand-edited v2 file still gets the
    // guarantees: unique ids, finite numbers, no dangling references.
    doc: normalizeV2(migrated.doc),
    notes: migrated.notes,
    warnings: migrated.warnings,
  }
}

export function serializeDoc(doc: CanvasDocV2): string {
  return serializeV2(doc)
}

/**
 * Hand a document to the browser as a file.
 *
 * The `.json` suffix is added when missing, because a file called "My map" that
 * downloads with no extension cannot be reopened by double-clicking it.
 */
export function downloadDoc(doc: CanvasDocV2, filename: string): void {
  const blob = new Blob([serializeV2(doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.json') ? filename : `${filename}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // A tick to let the download start before the URL is revoked. Revoking it
  // synchronously cancels the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
