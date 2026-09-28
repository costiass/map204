import { useEffect, useMemo, useRef, useState } from 'react'

import { IconDownload, IconUpload, IconX } from '@/components/Icons'
import { primePageSync } from '@/hooks/usePageSync'
import { loadDocument, replaceDocumentPages } from '@/store/supabase-sync'
import { useCanvasStore } from '@/store/useCanvasStore'
import { downloadDoc, parseDoc, serializeDoc } from '@/utils/serialize'
import { reissueIds } from '@/utils/reissue'
import { formatBytes } from '@/utils/image'
import type { CanvasDoc } from '@/types'

type Mode = 'replace' | 'merge'
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
  const replaceDoc = useCanvasStore((s) => s.replaceDoc)
  const mergeDoc = useCanvasStore((s) => s.mergeDoc)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const [tab, setTab] = useState<Tab>(initialTab)
  const [filename, setFilename] = useState('map204-page')
  const [raw, setRaw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [mode, setMode] = useState<Mode>('replace')
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
      cards: pages.reduce((sum, page) => sum + page.cards.length, 0),
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

    // An import **reproduces** the file rather than copying it: same cards,
    // positions, connections, styling and text, but every id re-issued. So the
    // result shares no identity with the file it came from, and importing the
    // same file twice gives you two independent documents rather than one that
    // quietly overwrites the other.
    const incoming = reissueIds(parsed).doc

    if (mode === 'replace' && documentId) {
      // The server must end up holding exactly these pages, so it is rewritten
      // first and the page-list diff is re-primed before the canvas swaps.
      const written = await replaceDocumentPages(documentId, incoming.pages)
      if (!written) {
        pushToast('The import could not be saved — the reason is in the console.', 'error')
        return
      }

      // Read the pages back rather than trusting the local copy. The server is
      // the authority on what exists now, and re-reading means a write that
      // silently did not land cannot leave the canvas holding a page the
      // database has never heard of — which is what the next save would then
      // try, and fail, to create.
      const refreshed = await loadDocument(documentId)
      if (!refreshed) {
        pushToast('The pages were written but could not be read back.', 'error')
        return
      }

      primePageSync(documentId, refreshed)
      replaceDoc({
        version: 1,
        pages: refreshed.pages,
        settings: refreshed.settings,
      })
      pushToast(`Imported ${written.length} page(s).`, 'success')
      setDialog(null)
      return
    }

    if (mode === 'replace') {
      // No workspace is open, so there is nowhere to save. Say so plainly.
      //
      // The tempting shortcut is to drop the pages into the local document and
      // let the page-list diff persist them later. That is what this used to do,
      // and it is a trap: the diff cannot tell an imported page from one you
      // typed, so the next workspace you opened would try to insert these pages
      // *into that workspace*. The insert then fails on
      //   42501 new row violates row-level security policy for table "pages"
      // for anyone without edit rights on the workspace they happened to open
      // next — an error that names the database and says nothing about an
      // import done several clicks earlier.
      setError(
        'Open a workspace first — there is nowhere to save these pages yet.',
      )
      return
    }

    // Merging also needs a workspace, for the same reason.
    if (!documentId) {
      setError('Open a workspace first — there is nowhere to save these pages yet.')
      return
    }

    mergeDoc(incoming)
    pushToast(
      `Merged ${incoming.pages.length} page(s) into the document.`,
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
                ['Cards', stats.cards],
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
                  {parsed.pages.reduce((sum, page) => sum + page.cards.length, 0)} card(s),{' '}
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

              <fieldset className="mt-3">
                <legend className="cc-label">How should this be applied?</legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {(
                    [
                      ['replace', 'Replace document', 'Discard the current pages and use the imported ones.'],
                      ['merge', 'Merge into document', 'Add new pages/cards, keeping what is already here.'],
                    ] as const
                  ).map(([value, title, description]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 text-[11px] ${
                        mode === value ? 'border-indigo-400 bg-indigo-50' : 'border-line hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="import-mode"
                        className="mt-0.5 accent-indigo-500"
                        checked={mode === value}
                        onChange={() => setMode(value)}
                      />
                      <span>
                        <span className="block font-semibold text-slate-700">{title}</span>
                        <span className="text-slate-500">{description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <div className="mt-auto flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <button type="button" className="cc-btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className="cc-btn" data-variant="primary" disabled={!parsed} onClick={() => void doImport()}>
                Import JSON
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
