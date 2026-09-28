import { memo, useCallback } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import { IconX } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import { ANCHORS, type Anchor, type Group, type Point } from '@/types'

export interface GroupNodeProps {
  group: Group
  selected: boolean
  dimmed: boolean
  offset: Point | null
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, groupId: string) => void
  /** The title bar's: drags without selecting. Falls back to `onPointerDown`. */
  onTitlePointerDown?: (event: ReactPointerEvent<HTMLElement>, groupId: string) => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>, groupId: string, side: Anchor) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLElement>, groupId: string) => void
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>, groupId: string) => void
}

function GroupNodeImpl({
  group,
  selected,
  dimmed,
  offset,
  onPointerDown,
  onTitlePointerDown,
  onHandlePointerDown,
  onResizePointerDown,
  onContextMenu,
}: GroupNodeProps) {
  const updateGroup = useCanvasStore((s) => s.updateGroup)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const deleteGroups = useCanvasStore((s) => s.deleteGroups)
  const selectGroup = useCanvasStore((s) => s.selectGroup)

  const x = group.x + (offset?.x ?? 0)
  const y = group.y + (offset?.y ?? 0)

  const style = {
    left: x,
    top: y,
    width: group.width,
    height: group.height,
    zIndex: group.zIndex,
    '--cc-group-color': group.color,
    border: `2px dashed ${group.color}55`,
    background: `${group.color}08`,
  } as CSSProperties

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation()
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.currentTarget.blur()
      }
    },
    [],
  )

  return (
    <div
      className="cc-group"
      style={style}
      data-group-id={group.id}
      data-selected={selected ? 'true' : undefined}
      data-dimmed={dimmed ? 'true' : undefined}
      onPointerDown={(event) => onPointerDown(event, group.id)}
      onContextMenu={(event) => onContextMenu(event, group.id)}
    >
      <header
        className="cc-group__header"
        style={{ background: `${group.color}18` }}
        /*
          Drag-only, like an element's title bar. Without a handler of its own this
          header falls through to the group's own pointerdown, which selects as well
          as drags -- so rearranging a group opened its properties panel every time.

          The title input below is the exception: it is a real field, so it keeps
          `data-no-drag` and a text cursor and is edited where it is drawn.
        */
        onPointerDown={(event) => {
          // The drag-only handler when the canvas supplied one. The fallback is the
          // group handler, which selects too -- a group with no drag-only handler
          // would otherwise have a title bar that cannot move it at all.
          const handler = onTitlePointerDown ?? onPointerDown
          handler(event, group.id)
        }}
      >
        <input
          className="cc-group__title"
          value={group.title}
          placeholder="Group name"
          spellCheck={false}
          aria-label="Group title"
          data-no-drag=""
          onKeyDown={handleTitleKeyDown}
          onChange={(event) => updateGroup(group.id, { title: event.target.value }, { silent: true })}
          onBlur={() => flushCommit()}
        />
        <button
          type="button"
          className="cc-group__btn"
          title="Delete group"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            selectGroup(null)
            deleteGroups([group.id])
          }}
        >
          <IconX size={12} />
        </button>
      </header>

      {ANCHORS.map((side) => (
        <span
          key={side}
          className="cc-handle"
          data-side={side}
          title={`Drag to connect from the ${side}`}
          onPointerDown={(event) => onHandlePointerDown(event, group.id, side)}
        />
      ))}

      <span
        className="cc-resize"
        title="Resize group"
        onPointerDown={(event) => onResizePointerDown(event, group.id)}
      />
    </div>
  )
}

export const GroupNode = memo(GroupNodeImpl)
