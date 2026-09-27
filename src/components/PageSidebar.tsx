import { useState } from 'react'

import { ColorPicker } from '@/components/ColorPicker'
import { IconPlus, IconTrash, IconX } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
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
  const filterTags = useCanvasStore((s) => s.filterTags)
  const filterColor = useCanvasStore((s) => s.filterColor)
  const toggleFilterTag = useCanvasStore((s) => s.toggleFilterTag)
  const setFilterColor = useCanvasStore((s) => s.setFilterColor)
  const clearFilters = useCanvasStore((s) => s.clearFilters)

  const [renamingId, setRenamingId] = useState<string | null>(null)

  const activePage = pages.find((page) => page.id === activePageId)
  const tags = activePage ? collectTags(activePage.cards) : []
  const colors = activePage ? collectColors(activePage.cards) : []
  const filtering = isFiltering({ query: '', tags: filterTags, color: filterColor })

  return (
    <aside className="cc-scroll flex h-full w-[15.5rem] shrink-0 flex-col overflow-y-auto border-r border-line bg-white">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pages</h2>
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
                  active ? 'bg-indigo-50 font-semibold text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
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
                  title={`${page.title} · ${page.cards.length} cards`}
                >
                  {page.title || 'Untitled page'}
                  <span className="ml-1.5 text-[11px] font-normal text-slate-400">{page.cards.length}</span>
                </button>
                {renamingId === page.id ? (
                  <input
                    autoFocus
                    defaultValue={page.title}
                    className="cc-input py-0.5 text-xs"
                    onBlur={(event) => {
                      renamePage(page.id, event.target.value)
                      setRenamingId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer rounded p-1 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100"
                    title="Delete page"
                    onClick={() => deletePage(page.id)}
                  >
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="mx-2 mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        onClick={() => addPage()}
      >
        <IconPlus size={14} /> New page
      </button>

      <div className="mt-3 border-t border-line px-3 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Filter</h2>
          {filtering ? (
            <button
              type="button"
              className="cursor-pointer text-[11px] font-semibold text-indigo-600 hover:underline"
              onClick={clearFilters}
            >
              Clear
            </button>
          ) : null}
        </div>

        {tags.length === 0 ? (
          <p className="mt-2 text-[11px] leading-snug text-slate-400">
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
            <p className="mt-1 text-[10.5px] text-slate-400">Click a colour to filter cards by it.</p>
          </div>
        ) : null}
      </div>


    </aside>
  )
}
