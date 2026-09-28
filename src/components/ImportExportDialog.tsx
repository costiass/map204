import { useEffect, useMemo, useRef, useState } from 'react'

import { IconDownload, IconUpload, IconX } from '@/components/Icons'
import { broadcastPagesImported, primePageSync } from '@/hooks/usePageSync'
import {
  importPages,
  loadDocument,
  type LoadedDocument,
  type WrittenPage,
} from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'
import { downloadDoc, parseDoc, serializeDoc } from '@/utils/serialize'
import { formatBytes } from '@/utils/image'
import type { CanvasDoc } from '@/types'
import { DOC_VERSION } from '@/types'

type Tab = 'export' | 'import'

export function ImportExportDialog() {
  const dialog = useCanvasStore((s) => s.dialog)

  // The body owns all draft state; unmounting it on close resets everything,
  // so there is no reset effect to keep in sync.
  if (!dialog) return null
  return <ImportExportBody initialTab={dialog} />
}

function ImportExportBody({ initialTab }: { initialTab: Tab }) {
  const setDialog = useCanvasStore((s) => s.setDialog)
  const doc = useCanvasStore((s) => s.doc)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const [tab, setTab] = useState<Tab>(initialTab)
  const [filename, setFilename] = useState('map204-page')
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  /** True while the server has the file, so the button can say so. */
  const [importing, setImporting] = useState(false)
  const [parsed, setParsed] = useState<CanvasDoc | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setDialog])

  const json = useMemo(() => (tab === 'export' ? serializeDoc(doc) : ''), [doc, tab])

  const stats = useMemo(() => {
    const pages = doc.pages
    return {
      pages: pages.length,
      elements: pages.reduce((sum, page) => sum + page.elements.length, 0),
      connections: pages.reduce((sum, page) => sum + page.connections.length, 0),
      bytes: json.length,
    }
  }, [doc, json])

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setRaw(text)
      validate(text)
    } catch {
      setError('Could not read that file.')
      setParsed(null)
    }
  }

  const validate = (text: string) => {
    if (!text.trim()) {
      setError(null)
      setParsed(null)
      setWarnings([])
      return
    }
    try {
      const result = parseDoc(text)
      setParsed(result.doc)
      setWarnings(result.warnings)
      setError(null)
    } catch (parseError) {
      setParsed(null)
      setWarnings([])
      setError(parseError instanceof Error ? parseError.message : 'Could not parse that JSON.')
    }
  }

  const doImport = async () => {
    if (!parsed) return
    const store = useCanvasStore.getState()
    const documentId = store.documentId

    // Nowhere to put the pages. Said plainly rather than dropped into the local
    // document: the page-list diff cannot tell an imported page from a typed
    // one, so it would try to insert them into whichever workspace was opened
    // next — an error about the database, caused by something done several
    // clicks earlier.
    if (!documentId) {
      setError('Open a workspace first — there is nowhere to save these pages yet.')
      return
    }

    setImporting(true)
    const pageCount = parsed.pages.length
    store.setStatus({
      busy: true,
      message: `Adding ${pageCount} page${pageCount === 1 ? '' : 's'}…`,
      detail: 'The server is inserting them in one go.',
    })

    let written: WrittenPage[] | null = null
    let failed = ''
    // Hoisted, because the check below is about what actually arrived and so has
    // to outlive the block that read it back.
    let refreshed: LoadedDocument | null = null

    try {
      // One call. The server mints every id, rewires every reference, and
      // inserts the pages in a single transaction — so this is either the whole
      // file or none of it, and the browser holds nothing but the file text.
      written = await importPages(documentId, parsed.pages)

      if (written) {
        // Read the pages back rather than trusting the request: the server
        // minted the ids, so the local copy cannot know them, and a page the
        // database has never heard of would be re-created — and fail — on the
        // next save.
        refreshed = await loadDocument(documentId)
        if (refreshed) {
          primePageSync(documentId, refreshed)
          store.replaceDoc({
            version: DOC_VERSION,
            pages: refreshed.pages,
            settings: refreshed.settings,
            // An import adds no uploads — pages and elements are JSON, not files.
            uploadBytes: store.doc.uploadBytes,
          })
          // Tell anyone else looking at this workspace to re-read. Their page
          // list is derived from what they last loaded, so without this they
          // would not know new pages had arrived.
          broadcastPagesImported(documentId, written.length)
        }
      } else {
        failed = 'The server refused the import.'
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : 'The import failed.'
    } finally {
      setImporting(false)
      store.setStatus(null)
    }

    if (!written) {
      setError(`${failed} The reason is in the console.`)
      return
    }

    // "Added N pages" is a claim about the *contents*, not the count.
    //
    // The import used to report success on a workspace full of blank pages: the
    // server function read its contents from a key the client had stopped
    // sending, `coalesce`d the absence to an empty array, and inserted N pages
    // with nothing in them. Every check passed — a transaction, a row count, a
    // fresh read-back — because the only thing wrong was the data, and nobody
    // looked at it.
    //
    // So the thing the caller actually wanted is compared against the thing the
    // caller actually sent. If pages came back empty and pages were offered, that
    // is a failure whatever the server said.
    const arrived = refreshed?.pages ?? []
    const offeredContent = parsed.pages.reduce((n, page) => n + page.elements.length, 0)
    const arrivedContent = arrived.reduce((n, page) => n + page.elements.length, 0)

    if (offeredContent > 0 && arrivedContent === 0) {
      setError(
        `The import created ${written.length} empty page${
          written.length === 1 ? '' : 's'
        } and nothing arrived in them. Nothing has been lost — the file is still on your disk — but the server did not accept the contents. See the console for the reason.`,
      )
      return
    }

    pushToast(
      `Added ${written.length} page${written.length === 1 ? '' : 's'}` +
        (arrivedContent > 0 ? ` with ${arrivedContent} elements` : '') +
        '.',
      'success',
    )
    setDialog(null)
  }

  return (
    <div className="cc-modal-backdrop" onPointerDown={() => setDialog(null)}>
      <div
        className="cc-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import and export"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="cc-seg">
            <button type="button" data-active={tab === 'export'} onClick={() => setTab('export')}>
              Export
            </button>
            <button type="button" data-active={tab === 'import'} onClick={() => setTab('import')}>
              Import
            </button>
          </div>
          <span className="ml-auto" />
          <button type="button" className="cc-btn px-2 py-1" onClick={() => setDialog(null)} aria-label="Close">
            <IconX size={14} />
          </button>
        </div>

        {tab === 'export' ? (
          <>
            <div className="grid grid-cols-2 gap-2 border-b border-line px-4 py-3 text-xs sm:grid-cols-4">
              {[
                ['Pages', stats.pages],
                ['Elements', stats.elements],
                ['Connections', stats.connections],
                ['File size', formatBytes(stats.bytes)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-slate-50 px-2.5 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                  <div className="text-sm font-bold text-slate-700">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <input
                className="cc-input"
                value={filename}
                onChange={(event) => setFilename(event.target.value)}
                aria-label="File name"
              />
              <button
                type="button"
                className="cc-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(json)
                  pushToast('JSON copied to the clipboard.', 'success')
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="cc-btn"
                data-variant="primary"
                onClick={() => {
                  downloadDoc(doc, filename)
                  pushToast('Exported as JSON.', 'success')
                }}
              >
                <IconDownload size={14} /> Download
              </button>
            </div>
            <pre className="cc-scroll mx-4 mb-4 flex-1 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">
              {json}
            </pre>
            <p className="px-4 pb-3 text-[11px] text-slate-500">
              The export keeps every world coordinate, size, colour, style and viewport exactly as stored.
            </p>
          </>
        ) : (
          <>
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="cc-btn cursor-pointer">
                  <IconUpload size={14} /> Choose .json file
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                      void handleFile(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </label>
                <span className="text-[11px] text-slate-500">or paste JSON below</span>
              </div>

              <textarea
                className="cc-input cc-scroll mt-2 h-40 resize-none font-mono text-[11px]"
                placeholder='{ "version": 1, "pages": [ … ] }'
                value={raw}
                onChange={(event) => {
                  setRaw(event.target.value)
                  validate(event.target.value)
                }}
              />

              {error ? (
                <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-medium text-red-700">
                  {error}
                </p>
              ) : null}

              {parsed ? (
                <div className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-800">
                  Valid document: {parsed.pages.length} page(s),{' '}
                  {parsed.pages.reduce((sum, page) => sum + page.elements.length, 0)} element(s),{' '}
                  {parsed.pages.reduce((sum, page) => sum + page.connections.length, 0)} connection(s).
                  {warnings.length > 0 ? (
                    <ul className="mt-1 list-disc pl-4 text-amber-800">
                      {warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <p className="mt-3 rounded-lg bg-surface-alt px-2.5 py-2 text-[11px] text-muted">
                Every page in the file is added to this workspace as a new page.
                Nothing already here is changed, and importing the same file twice
                gives you two independent copies.
              </p>
            </div>

            <div className="mt-auto flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button type="button" className="cc-btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cc-btn"
                data-variant="primary"
                disabled={!parsed || importing}
                onClick={() => void doImport()}
              >
                {importing
                  ? 'Adding pages…'
                  : `Add ${parsed?.pages.length ?? 0} page${parsed?.pages.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
