import { CardContentTab } from '@/components/CardContentTab'
import { ElementInspectorTab } from '@/components/ElementInspectorTab'
import { ElementSettingsTab } from '@/components/ElementSettingsTab'
import { ConnectionEditor } from '@/components/ConnectionEditor'
import { GroupEditor } from '@/components/GroupEditor'
import { IconFit, IconX } from '@/components/Icons'
import { MultiSelectEditor } from '@/components/MultiSelectEditor'
import { useCanvasStore } from '@/store/useCanvasStore'
import { rectOf, centerOn, rectCenter } from '@/utils/geometry'

/**
 * Right-hand inspector.
 *
 * It only exists while something is selected, and takes a meaningful slice of
 * the window (30% of the screen, never more than half) because the card body is
 * edited as a Markdown page here rather than in place on the canvas.
 *
 * A single card gets two tabs: Content (the Markdown page plus tags, steps and
 * images) and Settings (colours, border, layout, and making this style the
 * default). Several cards get the bulk editor; a single connection gets the
 * connection editor.
 */
export function Inspector() {
  const selectedElementIds = useCanvasStore((s) => s.selectedElementIds)
  const card = useCanvasStore((s) =>
    s.selectedElementIds.length === 1
      ? s.doc.pages.find((p) => p.id === s.activePageId)?.elements.find((c) => c.id === s.selectedElementIds[0])
      : undefined,
  )
  const group = useCanvasStore((s) =>
    s.selectedGroupId
      ? s.doc.pages.find((p) => p.id === s.activePageId)?.groups.find((g) => g.id === s.selectedGroupId)
      : undefined,
  )
  const connection = useCanvasStore((s) =>
    s.selectedConnectionIds.length === 1
      ? s.doc.pages
          .find((p) => p.id === s.activePageId)
          ?.connections.find((c) => c.id === s.selectedConnectionIds[0])
      : undefined,
  )
  const cardCount = useCanvasStore((s) =>
    s.doc.pages.find((p) => p.id === s.activePageId)?.elements.filter((c) => s.selectedElementIds.includes(c.id)).length ?? 0,
  )
  const clearSelection = useCanvasStore((s) => s.clearSelection)
  const tab = useCanvasStore((s) => s.inspectorTab)
  const setTab = useCanvasStore((s) => s.setInspectorTab)
  const updateElement = useCanvasStore((s) => s.updateElement)
  const updateGroup = useCanvasStore((s) => s.updateGroup)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const viewportSize = useCanvasStore((s) => s.viewportSize)
  const pageZoom = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId)?.viewport.zoom ?? 1)

  const open = cardCount > 0 || Boolean(connection) || Boolean(group)

  /*
   * A viewer gets no inspector at all.
   *
   * Every panel in here is an editing surface -- a title field, a colour picker, a
   * delete button -- so "hide the controls" would mean auditing each one, and the
   * next one added would be editable by a guest by default. The panel as a whole is
   * the thing that is wrong for a viewer.
   *
   * Nothing is lost by this: a viewer cannot select an element to begin with (the
   * canvas does not hand them a selection), and the title of whatever they were
   * looking at is on the element itself. This is the backstop for the paths that
   * could produce a selection anyway -- the keyboard, a marquee that outlived a role
   * change -- rather than the primary lock.
   */
  const readOnlyReason = useCanvasStore((s) => s.readOnlyReason)
  if (!open || readOnlyReason !== null) return null

  const heading = card
    ? card.title || 'Untitled'
    : group
      ? group.title || 'Untitled group'
      : connection
        ? 'Connection'
        : `${cardCount} cards selected`

  return (
    <aside className="cc-panel fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] shrink-0 flex-col border-t border-line bg-white shadow-lg md:static md:z-auto md:h-full md:max-h-none md:w-[clamp(30%,36vw,50%)] md:shrink-0 md:border-t-0 md:border-l md:shadow-none">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-2">
        {card ? (
          <>
            <input
              value={card.title}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-bold text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="Card title"
              aria-label="Card title"
              onChange={(event) => updateElement(card.id, { title: event.target.value }, { silent: true })}
              onBlur={() => flushCommit()}
            />
            <button
              type="button"
              className="cc-btn shrink-0 px-1.5 py-1"
              title="Centre this card in the viewport"
              onClick={() => setViewport(centerOn(rectCenter(rectOf(card)), viewportSize, Math.max(pageZoom, 0.8)))}
            >
              <IconFit size={13} />
            </button>
          </>
        ) : group ? (
          <>
            <input
              value={group.title}
              className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-bold text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="Group title"
              aria-label="Group title"
              onChange={(event) => updateGroup(group.id, { title: event.target.value }, { silent: true })}
              onBlur={() => flushCommit()}
            />
            <button
              type="button"
              className="cc-btn shrink-0 px-1.5 py-1"
              title="Centre this group in the viewport"
              onClick={() => setViewport(centerOn(rectCenter(rectOf(group)), viewportSize, Math.max(pageZoom, 0.8)))}
            >
              <IconFit size={13} />
            </button>
          </>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-700" title={heading}>
            {heading}
          </h2>
        )}
        <button
          type="button"
          className="cc-btn shrink-0 px-1.5 py-1"
          onClick={clearSelection}
          title="Close inspector (Esc)"
          aria-label="Close inspector"
        >
          <IconX size={14} />
        </button>
      </div>

      {card ? (
        <>
          <div className="flex shrink-0 gap-1 border-b border-line px-2 py-1.5">
            <button
              type="button"
              className="cc-tab"
              data-active={tab === 'content'}
              onClick={() => setTab('content')}
            >
              {card.kind === 'note' ? 'Content' : 'Source'}
            </button>
            <button
              type="button"
              className="cc-tab"
              data-active={tab === 'settings'}
              onClick={() => setTab('settings')}
            >
              Settings
            </button>
          </div>
          {/* Which tab panel gets mounted depends on the *kind*, not on how many
              are open. A note has a Markdown body, tags, a checklist and a
              style; a video has a link and a display mode. Showing the note tabs
              for a video would offer a colour picker for a thing with no colour. */}
          {/*
            Two panels for every kind, and only the *first* one is kind-specific.

            Settings used to be a note's, because a style was a note's field. Style
            and tags are on the base now, so colours, border and layout apply to a
            video and a deck as much as to a note — and an element you cannot
            restyle is one that looks like it was not made by whoever made the
            others. So the settings panel is shared, and the content tab is where
            the kinds differ: a note has a body, a video a link, a table a grid.
          */}
          {tab === 'settings' ? (
            <ElementSettingsTab key={card.id} element={card} />
          ) : card.kind === 'note' ? (
            <CardContentTab key={card.id} card={card} />
          ) : (
            <ElementInspectorTab key={card.id} element={card} />
          )}
        </>
      ) : null}

      {group ? <GroupEditor key={group.id} group={group} /> : null}

      {connection && !card ? <ConnectionEditor key={connection.id} connectionId={connection.id} /> : null}

      {!card && !connection && cardCount > 1 ? <MultiSelectEditor cardIds={selectedElementIds} /> : null}
    </aside>
  )
}
