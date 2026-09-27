import { Section } from '@/components/EditorParts'
import { ColorPicker } from '@/components/ColorPicker'
import { IconTrash } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, type Group } from '@/types'

/**
 * Inspector panel for editing a group: title, colour, position, membership.
 */
export function GroupEditor({ group }: { group: Group }) {
  const updateGroup = useCanvasStore((s) => s.updateGroup)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const deleteGroups = useCanvasStore((s) => s.deleteGroups)
  const addCardToGroup = useCanvasStore((s) => s.addCardToGroup)
  const removeCardFromGroup = useCanvasStore((s) => s.removeCardFromGroup)
  const addGroupToGroup = useCanvasStore((s) => s.addGroupToGroup)
  const removeGroupFromGroup = useCanvasStore((s) => s.removeGroupFromGroup)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const pushToast = useCanvasStore((s) => s.pushToast)

  if (!page) return null

  const otherCards = page.cards.filter((c) => !group.memberCardIds.includes(c.id))
  const otherGroups = page.groups.filter((g) => g.id !== group.id && !group.memberGroupIds.includes(g.id))

  return (
    <div className="cc-scroll flex-1 overflow-y-auto">
      <Section title="Group">
        <label className="block">
          <span className="cc-label">Title</span>
          <input
            className="cc-input"
            value={group.title}
            placeholder="Group name"
            onChange={(event) => updateGroup(group.id, { title: event.target.value }, { silent: true })}
            onBlur={() => flushCommit()}
          />
        </label>
        <div className="mt-3">
          <ColorPicker
            label="Colour"
            value={group.color}
            colors={CARD_ACCENTS}
            onChange={(color) => updateGroup(group.id, { color })}
          />
        </div>
      </Section>

      <Section title={`Cards (${group.memberCardIds.length})`}>
        {group.memberCardIds.length === 0 ? (
          <p className="text-[11px] text-slate-400">No cards in this group yet.</p>
        ) : (
          <ul className="space-y-1">
            {group.memberCardIds.map((cardId) => {
              const card = page.cards.find((c) => c.id === cardId)
              if (!card) return null
              return (
                <li key={cardId} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: card.style.accentColor }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                    {card.title || 'Untitled'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-slate-400 hover:text-red-600"
                    onClick={() => removeCardFromGroup(group.id, cardId)}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {otherCards.length > 0 ? (
          <select
            className="cc-input mt-2"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addCardToGroup(group.id, event.target.value)
                pushToast('Card added to group.', 'success')
              }
            }}
          >
            <option value="">+ Add card to group…</option>
            {otherCards.map((card) => (
              <option key={card.id} value={card.id}>
                {card.title || 'Untitled'}
              </option>
            ))}
          </select>
        ) : null}
      </Section>

      <Section title={`Groups (${group.memberGroupIds.length})`}>
        {group.memberGroupIds.length === 0 ? (
          <p className="text-[11px] text-slate-400">No groups inside this group yet.</p>
        ) : (
          <ul className="space-y-1">
            {group.memberGroupIds.map((groupId) => {
              const childGroup = page.groups.find((g) => g.id === groupId)
              if (!childGroup) return null
              return (
                <li key={groupId} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: childGroup.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                    {childGroup.title || 'Untitled group'}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-slate-400 hover:text-red-600"
                    onClick={() => removeGroupFromGroup(group.id, groupId)}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {otherGroups.length > 0 ? (
          <select
            className="cc-input mt-2"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addGroupToGroup(group.id, event.target.value)
                pushToast('Group added to group.', 'success')
              }
            }}
          >
            <option value="">+ Add group to group…</option>
            {otherGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title || 'Untitled group'}
              </option>
            ))}
          </select>
        ) : null}
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="cc-label">X</span>
            <input
              type="number"
              className="cc-input"
              value={group.position.x}
              onChange={(event) => updateGroup(group.id, { position: { ...group.position, x: Number(event.target.value) } })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Y</span>
            <input
              type="number"
              className="cc-input"
              value={group.position.y}
              onChange={(event) => updateGroup(group.id, { position: { ...group.position, y: Number(event.target.value) } })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Width</span>
            <input
              type="number"
              className="cc-input"
              value={group.position.width}
              onChange={(event) => updateGroup(group.id, { position: { ...group.position, width: Number(event.target.value) } })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Height</span>
            <input
              type="number"
              className="cc-input"
              value={group.position.height}
              onChange={(event) => updateGroup(group.id, { position: { ...group.position, height: Number(event.target.value) } })}
            />
          </label>
        </div>
      </Section>

      <Section title="Danger zone">
        <button
          type="button"
          className="cc-btn"
          data-variant="danger"
          onClick={() => deleteGroups([group.id])}
        >
          <IconTrash size={13} /> Delete group
        </button>
      </Section>
    </div>
  )
}
