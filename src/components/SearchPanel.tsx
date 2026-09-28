import { useEffect, useMemo, useRef } from 'react'

import { IconSearch, IconX } from '@/components/Icons'
import { elementKind } from '@/elements/registry'
import { useCanvasStore } from '@/store/useCanvasStore'
import { visualRectOf, centerOn, rectCenter } from '@/utils/geometry'
import { isFiltering, matchesFilters, splitMatch } from '@/utils/filters'
import { markdownToPlainText } from '@/utils/markdown'

export function SearchPanel() {
  const searchOpen = useCanvasStore((s) => s.searchOpen)
  const setSearchOpen = useCanvasStore((s) => s.setSearchOpen)
  const query = useCanvasStore((s) => s.searchQuery)
  const setQuery = useCanvasStore((s) => s.setSearchQuery)
  const filterTags = useCanvasStore((s) => s.filterTags)
  const filterColor = useCanvasStore((s) => s.filterColor)
  const clearFilters = useCanvasStore((s) => s.clearFilters)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  // Clear filters when the search panel closes.
  const prevOpen = useRef(searchOpen)
  useEffect(() => {
    if (prevOpen.current && !searchOpen) {
      clearFilters()
    }
    prevOpen.current = searchOpen
  }, [searchOpen, clearFilters])

  const filters = useMemo(
    () => ({ query, tags: filterTags, color: filterColor }),
    [query, filterTags, filterColor],
  )
  const results = useMemo(() => {
    if (!page) return []
    return page.elements
      .filter((card) => matchesFilters(card, filters))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [page, filters])

  if (!searchOpen) return null

  const focusElement = (elementId: string) => {
    const store = useCanvasStore.getState()
    const target = store.doc.pages.find((p) => p.id === store.activePageId)
    const element = target?.elements.find((c) => c.id === elementId)
    if (!target || !element) return
    store.selectElements([elementId])
    const zoom = Math.min(Math.max(target.viewport.zoom, 0.7), 1.2)
    // The visual rect, so jumping to a collapsed element frames the title bar
    // that is on screen rather than the height it would occupy expanded.
    store.setViewport(centerOn(rectCenter(visualRectOf(element)), store.viewportSize, zoom))
  }

  const active = isFiltering(filters)

  return (
    <div className="absolute left-3 top-3 z-40 w-[19rem] max-w-[calc(100%-1.5rem)]">
      <div className="cc-panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
          <IconSearch size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search titles, notes, tags…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-muted"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                clearFilters()
                setSearchOpen(false)
              }
              if (event.key === 'Enter' && results[0]) focusElement(results[0].id)
            }}
          />
          <button
            type="button"
            className="shrink-0 cursor-pointer rounded p-1 text-muted hover:bg-surface-sunken"
            title="Close search"
            onClick={() => setSearchOpen(false)}
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="cc-scroll max-h-[22rem] overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted">
              {active ? 'No cards match these filters.' : 'No cards on this page yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((element) => {
                const { before, match, after } = splitMatch(element.title, query)
                // A body, tags and an accent colour belong to a note. The rest
                // are found by their title, and this is the line that says so
                // rather than reading a field that is not there.
                const note = element.kind === 'note' ? element : null
                const snippet = note ? markdownToPlainText(note.body).slice(0, 90) : ''
                const tags = note?.tags ?? []
                const KindIcon = elementKind(element.kind).icon
                return (
                  <li key={element.id}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left hover:bg-surface-alt"
                      onClick={() => focusElement(element.id)}
                    >
                      <span className="flex items-center gap-2">
                        <KindIcon size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate text-[13px] font-semibold text-ink-strong">
                          {match ? (
                            <>
                              {before}
                              <mark className="rounded bg-amber-200 text-inherit">{match}</mark>
                              {after}
                            </>
                          ) : (
                            element.title
                          )}
                        </span>
                      </span>
                      {snippet ? <span className="line-clamp-1 pl-5 text-[11px] text-muted">{snippet}</span> : null}
                      {tags.length > 0 ? (
                        <span className="flex flex-wrap gap-1 pl-5">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="cc-tag"
                              style={{
                                background: filterTags.includes(tag) ? '#6366F1' : undefined,
                                color: filterTags.includes(tag) ? '#ffffff' : undefined,
                              }}
                            >
                              #{tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-muted">
          <span>
            {results.length} of {page?.elements.length ?? 0} cards
          </span>
          {active ? (
            <button
              type="button"
              className="cursor-pointer font-semibold text-brand-ink hover:underline"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
