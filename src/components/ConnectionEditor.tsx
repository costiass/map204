import { useState } from 'react'

import { ColorPicker } from '@/components/ColorPicker'
import { IconPalette, IconReset, IconTrash } from '@/components/Icons'
import { useCanvasStore } from '@/store/useCanvasStore'
import {
  ANCHORS,
  ARROW_STYLES,
  CONNECTION_COLORS,
  LINE_STYLES,
  NO_RELATIONSHIP,
  RELATIONSHIP_PRESETS,
  ROUTINGS,
  type Anchor,
  type ArrowStyle,
  type LineStyle,
  type Routing,
} from '@/types'

function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T
  options: readonly T[]
  labels?: Record<string, string>
  onChange: (value: T) => void
}) {
  return (
    <div className="cc-seg flex-wrap">
      {options.map((option) => (
        <button key={option} type="button" data-active={value === option} onClick={() => onChange(option)}>
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  )
}

function AnchorPicker({
  value,
  onChange,
}: {
  value: Anchor | null
  onChange: (anchor: Anchor | null) => void
}) {
  return (
    <div className="cc-seg flex-wrap">
      <button type="button" data-active={value === null} onClick={() => onChange(null)}>
        auto
      </button>
      {ANCHORS.map((anchor) => (
        <button key={anchor} type="button" data-active={value === anchor} onClick={() => onChange(anchor)}>
          {anchor}
        </button>
      ))}
    </div>
  )
}

export function ConnectionEditor({
  connectionId,
}: {
  connectionId: string
}) {
  const connection = useCanvasStore((s) =>
    s.doc.pages.find((p) => p.id === s.activePageId)?.connections.find((c) => c.id === connectionId),
  )
  const page = useCanvasStore((s) => s.doc.pages.find((p) => p.id === s.activePageId))
  const updateConnection = useCanvasStore((s) => s.updateConnection)
  const updateConnectionStyle = useCanvasStore((s) => s.updateConnectionStyle)
  const deleteConnections = useCanvasStore((s) => s.deleteConnections)
  const setDefaultConnectionPreset = useCanvasStore((s) => s.setDefaultConnectionPreset)
  const resetDefaultStyles = useCanvasStore((s) => s.resetDefaultStyles)
  const pushToast = useCanvasStore((s) => s.pushToast)
  const defaultRelationship = useCanvasStore((s) => s.doc.settings.defaultRelationshipType)
  const defaultStyle = useCanvasStore((s) => s.doc.settings.defaultConnectionStyle)
  const [customType, setCustomType] = useState(false)

  if (!connection || !page) return null

  const source =
    connection.source.kind === 'card'
      ? page.cards.find((card) => card.id === connection.source.id)?.title ?? 'Missing card'
      : page.groups.find((group) => group.id === connection.source.id)?.title ?? 'Missing group'
  const target =
    connection.target.kind === 'card'
      ? page.cards.find((card) => card.id === connection.target.id)?.title ?? 'Missing card'
      : page.groups.find((group) => group.id === connection.target.id)?.title ?? 'Missing group'
  const sourceLabel = connection.source.kind === 'card' ? 'Card' : 'Group'
  const targetLabel = connection.target.kind === 'card' ? 'Card' : 'Group'
  const { style } = connection

  const isDefault =
    defaultRelationship === connection.relationshipType &&
    (Object.keys(defaultStyle) as Array<keyof typeof defaultStyle>).every(
      (key) => defaultStyle[key] === style[key],
    )

  const swap = () => {
    updateConnection(connection.id, {
      source: connection.target,
      target: connection.source,
      sourceAnchor: connection.targetAnchor,
      targetAnchor: connection.sourceAnchor,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The inspector owns the panel title and close button; this row is the
          connection's own actions. */}
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5">
        <button type="button" className="cc-btn px-2 py-1" title="Swap direction" onClick={swap}>
          Swap direction
        </button>
        <button
          type="button"
          className="cc-btn px-1.5 py-1"
          data-variant="danger"
          title="Delete connection"
          onClick={() => deleteConnections([connection.id])}
        >
          <IconTrash size={13} />
        </button>
      </div>

      <div className="cc-scroll flex-1 overflow-y-auto">
        <section className="border-b border-line px-3 py-3">
          <h3 className="cc-label">Endpoints</h3>
          <p className="text-[12px] text-slate-600">
            <span className="font-semibold">{source}</span>
            <span className="mx-1.5 text-slate-400">({sourceLabel})</span>
            <span className="mx-1.5 text-slate-400">→</span>
            <span className="font-semibold">{target}</span>
            <span className="mx-1.5 text-slate-400">({targetLabel})</span>
          </p>
          <p className="mt-1 font-mono text-[10px] text-slate-400">
            {connection.source.id} → {connection.target.id}
          </p>
        </section>

        <section className="border-b border-line px-3 py-3">
          <h3 className="cc-label">Label</h3>
          <input
            className="cc-input"
            placeholder="e.g. explains"
            defaultValue={connection.label}
            onBlur={(event) => {
              if (event.target.value !== connection.label) {
                updateConnection(connection.id, { label: event.target.value })
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />

          <h3 className="cc-label mt-3">Relationship</h3>
          <div className="cc-seg mb-1.5 flex-wrap">
            <button
              key="__none__"
              type="button"
              data-active={connection.relationshipType === NO_RELATIONSHIP}
              onClick={() => {
                setCustomType(false)
                updateConnection(connection.id, { relationshipType: NO_RELATIONSHIP })
              }}
            >
              None
            </button>
            {RELATIONSHIP_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                data-active={connection.relationshipType === preset}
                onClick={() => {
                  setCustomType(false)
                  updateConnection(connection.id, { relationshipType: preset })
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <p className="mb-1.5 text-[11px] leading-snug text-slate-500">
            {connection.relationshipType === NO_RELATIONSHIP
              ? 'This link has no relationship word. Use the label above if you want to write one.'
              : defaultRelationship === NO_RELATIONSHIP
                ? 'New links are created without a relationship word.'
                : `New links get “${defaultRelationship}” by default.`}
          </p>
          <button
            type="button"
            className="cursor-pointer text-[11px] font-semibold text-indigo-600 hover:underline"
            onClick={() => setCustomType((v) => !v)}
          >
            {customType ? 'Hide custom value' : 'Use a custom value'}
          </button>
          {customType ||
          (connection.relationshipType !== NO_RELATIONSHIP &&
            !(RELATIONSHIP_PRESETS as readonly string[]).includes(connection.relationshipType)) ? (
            <input
              className="cc-input mt-1.5"
              placeholder="e.g. refines"
              defaultValue={connection.relationshipType}
              onBlur={(event) => updateConnection(connection.id, { relationshipType: event.target.value })}
            />
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="cc-btn"
              disabled={isDefault}
              onClick={() => {
                setDefaultConnectionPreset({
                  style: connection.style,
                  relationshipType: connection.relationshipType,
                })
                pushToast('New links will look and read like this one.', 'success')
              }}
            >
              <IconPalette size={13} /> Set as default for new links
            </button>
            <button
              type="button"
              className="cc-btn"
              onClick={() => {
                resetDefaultStyles()
                pushToast('Default card and link styles reset.', 'info')
              }}
            >
              <IconReset size={13} /> Reset defaults
            </button>
          </div>
        </section>

        <section className="space-y-3 border-b border-line px-3 py-3">
          <h3 className="cc-label">Routing</h3>
          <Segmented<Routing>
            value={style.routing}
            options={ROUTINGS}
            onChange={(routing) => updateConnectionStyle(connection.id, { routing })}
          />

          <div>
            <h3 className="cc-label">Source side</h3>
            <AnchorPicker
              value={connection.sourceAnchor}
              onChange={(sourceAnchor) => updateConnection(connection.id, { sourceAnchor })}
            />
          </div>
          <div>
            <h3 className="cc-label">Target side</h3>
            <AnchorPicker
              value={connection.targetAnchor}
              onChange={(targetAnchor) => updateConnection(connection.id, { targetAnchor })}
            />
          </div>
        </section>

        <section className="space-y-3 border-b border-line px-3 py-3">
          <h3 className="cc-label">Line</h3>
          <Segmented<LineStyle>
            value={style.lineStyle}
            options={LINE_STYLES}
            onChange={(lineStyle) => updateConnectionStyle(connection.id, { lineStyle })}
          />
          <label className="block">
            <span className="cc-label">Width {style.width}px</span>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={style.width}
              className="w-full accent-indigo-500"
              onChange={(event) =>
                updateConnectionStyle(connection.id, { width: Number(event.target.value) }, { silent: true })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              className="accent-indigo-500"
              checked={style.animated}
              onChange={(event) => updateConnectionStyle(connection.id, { animated: event.target.checked })}
            />
            Animated flow
          </label>
          <ColorPicker
            label="Colour"
            value={style.color}
            colors={CONNECTION_COLORS}
            onChange={(color) => updateConnectionStyle(connection.id, { color })}
          />
        </section>

        <section className="space-y-3 px-3 py-3">
          <div>
            <h3 className="cc-label">Start arrow</h3>
            <Segmented<ArrowStyle>
              value={style.arrowStart}
              options={ARROW_STYLES}
              onChange={(arrowStart) => updateConnectionStyle(connection.id, { arrowStart })}
            />
          </div>
          <div>
            <h3 className="cc-label">End arrow</h3>
            <Segmented<ArrowStyle>
              value={style.arrowEnd}
              options={ARROW_STYLES}
              onChange={(arrowEnd) => updateConnectionStyle(connection.id, { arrowEnd })}
            />
          </div>
          <p className="font-mono text-[10px] text-slate-400">{connection.id}</p>
        </section>
      </div>
    </div>
  )
}
