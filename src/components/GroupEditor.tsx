import { Section } from '@/components/EditorParts'
import { ColorPicker } from '@/components/ColorPicker'
import { IconTrash } from '@/components/Icons'
import { elementKind } from '@/elements/registry'
import { useCanvasStore } from '@/store/useCanvasStore'
import { CARD_ACCENTS, type Group } from '@/types'

/**
 * Inspector panel for editing a group: title, colour, layout, membership.
 *
 * A group holds *elements* of any kind, not cards, so the member list labels
 * each one with its kind rather than assuming a note's accent colour.
 */
export function GroupEditor({ group }: { group: Group }) {
  const updateGroup = useCanvasStore((s) => s.updateGroup)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const deleteGroups = useCanvasStore((s) => s.deleteGroups)
  const addElementToGroup = useCanvasStore((s) => s.addElementToGroup)
  const removeElementFromGroup = useCanvasStore((s) => s.removeElementFromGroup)
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const pushToast = useCanvasStore((s) => s.pushToast)

  if (!page) return null

  const otherElements = page.elements.filter((c) => !group.memberIds.includes(c.id))

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

      <Section title={`Elements (${group.memberIds.length})`}>
        {group.memberIds.length === 0 ? (
          <p className="text-[11px] text-slate-400">No elements in this group yet.</p>
        ) : (
          <ul className="space-y-1">
            {group.memberIds.map((elementId) => {
              const element = page.elements.find((c) => c.id === elementId)
              if (!element) return null
              const kind = elementKind(element.kind)
              const Icon = kind.icon
              return (
                <li key={elementId} className="flex items-center gap-2">
                  {/* A group can hold any kind, and only a note has an accent
                      colour to dot with. The icon is what tells them apart. */}
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                    {element.title || 'Untitled'}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{kind.label}</span>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer text-slate-400 hover:text-red-600"
                    onClick={() => removeElementFromGroup(group.id, elementId)}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {otherElements.length > 0 ? (
          <select
            className="cc-input mt-2"
            value=""
            onChange={(event) => {
              if (event.target.value) {
                addElementToGroup(group.id, event.target.value)
                pushToast('Added to group.', 'success')
              }
            }}
          >
            <option value="">+ Add to group…</option>
            {otherElements.map((element) => (
              <option key={element.id} value={element.id}>
                {element.title || 'Untitled'}
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
              value={group.x}
              onChange={(event) => updateGroup(group.id, { x: Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Y</span>
            <input
              type="number"
              className="cc-input"
              value={group.y}
              onChange={(event) => updateGroup(group.id, { y: Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Width</span>
            <input
              type="number"
              className="cc-input"
              value={group.width}
              onChange={(event) => updateGroup(group.id, { width: Number(event.target.value) })}
            />
          </label>
          <label className="block">
            <span className="cc-label">Height</span>
            <input
              type="number"
              className="cc-input"
              value={group.height}
              onChange={(event) => updateGroup(group.id, { height: Number(event.target.value) })}
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
