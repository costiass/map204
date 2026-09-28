import { useState } from 'react'

import { ColorPicker } from '@/components/ColorPicker'
import { IconPencil, IconPlus, IconTrash, IconX } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { usePresence } from '@/store/presence'
import { collectColors, collectTags, isFiltering, normalizeColor } from '@/utils/filters'

interface PageSidebarProps {
  onClose?: () => void
}

export function PageSidebar({ onClose }: PageSidebarProps) {
  const pages = useCanvasStore((s) => s.doc.pages)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const setActivePage = useCanvasStore((s) => s.setActivePage)
  const addPage = useCanvasStore((s) => s.addPage)
  const deletePage = useCanvasStore((s) => s.deletePage)
  const renamePage = useCanvasStore((s) => s.renamePage)

  /*
   * Read from the store as state rather than `getState()` inside a handler, so that
   * switching between a map you own and one you were shown re-renders this panel
   * with the right controls. A `getState()` guard inside each click would stop the
   * *write* and still leave a viewer looking at a page list full of buttons that
   * do nothing.
   */
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)
  const editable = readOnlyReason === null
  const filterTags = useCanvasStore((s) => s.filterTags)
  const filterColor = useCanvasStore((s) => s.filterColor)
  const toggleFilterTag = useCanvasStore((s) => s.toggleFilterTag)
  const setFilterColor = useCanvasStore((s) => s.setFilterColor)
  const clearFilters = useCanvasStore((s) => s.clearFilters)

  const [renamingId, setRenamingId] = useState<string | null>(null)

  // Who is looking at which page. A pointer is only drawn for people on the page
  // you are on, so without this the sidebar would be the only place you could
  // tell that somebody had moved to another page — which is exactly the moment
  // you would want to know, and the moment following needs to handle.
  const presence = usePresence((s) => s.entries)
  const viewersByPage = presence.reduce<Record<string, typeof presence>>((map, entry) => {
    if (!entry.pageId) return map
    ;(map[entry.pageId] ??= []).push(entry)
    return map
  }, {})

  const activePage = pages.find((page) => page.id === activePageId)
  const tags = activePage ? collectTags(activePage.elements) : []
  const colors = activePage ? collectColors(activePage.elements) : []
  const filtering = isFiltering({ query: '', tags: filterTags, color: filterColor })

  return (
    <aside className="cc-scroll flex h-full w-[15.5rem] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Pages</h2>
        {onClose ? (
          <button type="button" className="cc-btn px-1.5 py-1 lg:hidden" onClick={onClose} aria-label="Close sidebar">
            <IconX size={14} />
          </button>
        ) : null}
      </div>

      <ul className="space-y-0.5 px-2">
        {pages.map((page) => {
          const active = page.id === activePageId
          return (
            <li key={page.id}>
              <div
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
                  active ? 'bg-brand-soft font-semibold text-brand-ink' : 'text-ink hover:bg-surface-alt'
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 cursor-pointer truncate text-left"
                  onClick={() => {
                    setActivePage(page.id)
                    onClose?.()
                  }}
                  onDoubleClick={() => setRenamingId(page.id)}
                  title={`${page.title} · ${page.elements.length} cards`}
                >
                  {page.title || 'Untitled page'}
                  <span className="ml-1.5 text-[11px] font-normal text-muted">{page.elements.length}</span>
                </button>

                {/* Who is on this page. On your own page it is redundant with
                    the pointers, but on any other page it is the only sign
                    somebody is working over there. */}
                {viewersByPage[page.id]?.length ? (
                  <span className="flex shrink-0 items-center -space-x-1.5">
                    {viewersByPage[page.id].slice(0, 3).map((entry) => (
                      <span
                        key={entry.userId}
                        className="block h-5 w-5 overflow-hidden rounded-full border-2 border-[var(--cc-surface)]"
                        style={{ background: entry.color }}
                        title={`${entry.name} is on this page`}
                      >
                        {entry.avatarUrl ? (
                          <img src={entry.avatarUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="grid h-full w-full place-items-center text-[9px] font-bold text-white">
                            {entry.name.trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                      </span>
                    ))}
                    {viewersByPage[page.id].length > 3 ? (
                      <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--cc-surface)] bg-[var(--cc-muted)] text-[9px] font-bold text-white">
                        +{viewersByPage[page.id].length - 3}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                {renamingId === page.id ? (
                  <input
                    autoFocus
                    defaultValue={page.title}
                    aria-label="Page name"
                    className="cc-input py-0.5 text-xs"
                    onFocus={(event) => event.currentTarget.select()}
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      // Commit on blur, Enter or Escape alike — an uncommitted
                      // rename was how "renaming does nothing" happened.
                      if (next && next !== page.title) renamePage(page.id, next)
                      setRenamingId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
                    }}
                  />
                ) : (
                  <span className="flex shrink-0 items-center gap-0.5">
                    {/* Rename was double-click only, which is invisible and
                        unreachable by keyboard. */}
                    {editable ? (
                      <button
                        type="button"
                        className="cursor-pointer rounded p-1 text-muted opacity-100 transition hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        title="Rename page"
                        aria-label={`Rename ${page.title || 'page'}`}
                        onClick={() => setRenamingId(page.id)}
                      >
                        <IconPencil size={13} />
                      </button>
                    ) : null}
                    {editable ? (
                      <button
                        type="button"
                        className="cursor-pointer rounded p-1 text-muted opacity-100 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        title="Delete page"
                        aria-label={`Delete ${page.title || 'page'}`}
                        onClick={() => deletePage(page.id)}
                      >
                        <IconTrash size={13} />
                      </button>
                    ) : null}
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/*
        New page.

        Not rendered for a viewer, and this is the one the database would refuse
        anyway -- a viewer cannot write to the pages table, so the button could only
        ever have produced an error in the console and a page that did not appear.
        The RLS policy is the real lock; this is the interface agreeing with it
        instead of arguing with it in front of the person using it.

        Everything below this -- filtering, and switching between pages -- is reading,
        so it stays.
      */}
      {editable ? (
        <button
          type="button"
          className="mx-2 mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-alt hover:text-ink-strong"
          onClick={() => addPage()}
        >
          <IconPlus size={14} /> New page
        </button>
      ) : null}

      <div className="mt-3 border-t border-line px-3 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Filter</h2>
          {filtering ? (
            <button
              type="button"
              className="cursor-pointer text-[11px] font-semibold text-brand-ink hover:underline"
              onClick={clearFilters}
            >
              Clear
            </button>
          ) : null}
        </div>

        {tags.length === 0 ? (
          <p className="mt-2 text-[11px] leading-snug text-muted">
            Tags on this page show up here as filters.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="cc-tag cursor-pointer"
                data-active={filterTags.includes(tag) ? 'true' : undefined}
                style={
                  filterTags.includes(tag)
                    ? { background: '#6366F1', color: '#ffffff' }
                    : { background: '#f1f5f9', color: '#475569' }
                }
                onClick={() => toggleFilterTag(tag)}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {colors.length > 0 ? (
          <div className="mt-3">
            <ColorPicker
              value={filterColor ?? '#ffffff'}
              colors={colors}
              columns={6}
              onChange={(color) => setFilterColor(normalizeColor(color) === normalizeColor(filterColor) ? null : color)}
            />
            <p className="mt-1 text-[10.5px] text-muted">Click a colour to filter cards by it.</p>
          </div>
        ) : null}
      </div>


    </aside>
  )
}
