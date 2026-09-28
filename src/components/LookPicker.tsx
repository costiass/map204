import { WorkspaceMark } from '@/components/WorkspaceMark'
import {
  WORKSPACE_ACCENTS,
  WORKSPACE_ICONS,
  getWorkspaceAccent,
  type WorkspaceAccentId,
} from '@/theme'

interface LookPickerProps {
  accent: string | null | undefined
  icon: string | null | undefined
  onAccent: (accent: string) => void
  onIcon: (icon: string) => void
  /** The heading, so the same control reads correctly in both places. */
  heading?: string
}

/**
 * Colour and icon chooser for a workspace.
 *
 * Shown twice — beside the "new workspace" field, and on a tile that already
 * exists — so it is one component rather than two that drift apart. Both sets
 * of options come from `src/theme.ts`, which is also what the database check
 * constraints are written against.
 */
export function LookPicker({
  accent,
  icon,
  onAccent,
  onIcon,
  heading,
}: LookPickerProps) {
  return (
    <div>
      {heading ? (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {heading}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {WORKSPACE_ACCENTS.map((option) => {
          const active = option.id === accent
          return (
            <button
              key={option.id}
              type="button"
              className="h-6 w-6 rounded-full transition hover:scale-110"
              style={{
                background: option.base,
                // A ring rather than a border, so the swatch keeps its size and
                // the grid does not jump as the selection moves.
                boxShadow: active
                  ? `0 0 0 2px var(--cc-surface), 0 0 0 4px ${option.base}`
                  : undefined,
              }}
              title={option.label}
              aria-label={`Colour: ${option.label}`}
              aria-pressed={active}
              onClick={() => onAccent(option.id)}
            />
          )
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1">
        {WORKSPACE_ICONS.map((option) => {
          const active = option.id === icon
          return (
            <button
              key={option.id}
              type="button"
              className="grid h-7 w-7 place-items-center rounded-lg border transition hover:bg-surface-sunken"
              style={{
                borderColor: active
                  ? getWorkspaceAccent(accent as WorkspaceAccentId).base
                  : 'var(--cc-line)',
                background: active
                  ? getWorkspaceAccent(accent as WorkspaceAccentId).soft
                  : 'transparent',
              }}
              title={option.label}
              aria-label={`Icon: ${option.label}`}
              aria-pressed={active}
              onClick={() => onIcon(option.id)}
            >
              <WorkspaceMark
                icon={option.id}
                accent={accent}
                size={14}
                className={active ? '' : 'opacity-60'}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
