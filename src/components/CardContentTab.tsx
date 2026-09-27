import { useRef, useState } from 'react'

import { Section } from '@/components/EditorParts'
import { IconImage, IconX } from '@/components/Icons'
import { MarkdownEditor } from '@/components/MarkdownEditor'
import { useCanvasStore } from '@/store/useCanvasStore'
import type { Card } from '@/types'
import { fileToDataUrl } from '@/utils/image'

/**
 * The Content tab: the card treated as a small Markdown page. The source lives
 * on the left with a live preview, and everything else about the card's
 * *content* (banner image, tags, steps, children) sits underneath it.
 */
export function CardContentTab({ card }: { card: Card }) {
  const updateCard = useCanvasStore((s) => s.updateCard)
  const flushCommit = useCanvasStore((s) => s.flushCommit)
  const setCardImage = useCanvasStore((s) => s.setCardImage)
  const addTag = useCanvasStore((s) => s.addTag)
  const removeTag = useCanvasStore((s) => s.removeTag)
  const addChecklistItem = useCanvasStore((s) => s.addChecklistItem)
  const updateChecklistItem = useCanvasStore((s) => s.updateChecklistItem)
  const removeChecklistItem = useCanvasStore((s) => s.removeChecklistItem)
  const pages = useCanvasStore((s) => s.doc.pages)
  const activePageId = useCanvasStore((s) => s.activePageId)
  const pushToast = useCanvasStore((s) => s.pushToast)

  const [tagDraft, setTagDraft] = useState('')
  const altInputRef = useRef<HTMLInputElement>(null)
  const childTitles = (pages.find((page) => page.id === activePageId)?.cards ?? [])
    .filter((other) => other.parentId === card.id)
    .map((other) => other.title || 'Untitled card')

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file)
      setCardImage(card.id, { src: dataUrl, alt: altInputRef.current?.value ?? card.image.alt })
      pushToast('Banner image embedded in the card.', 'success')
    } catch {
      pushToast('Could not read that image file.', 'error')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <MarkdownEditor
          value={card.content}
          ariaLabel={`Markdown body of ${card.title}`}
          onChange={(content) => updateCard(card.id, { content }, { silent: true })}
          onCommit={flushCommit}
        />
      </div>

      <div className="cc-scroll max-h-[45%] shrink-0 overflow-y-auto border-t border-line">
        <Section
          title="Banner image"
          action={
            card.image.src ? (
              <button
                type="button"
                className="cursor-pointer text-[11px] font-semibold text-slate-500 hover:text-red-600"
                onClick={() => setCardImage(card.id, { src: null, alt: '' })}
              >
                Remove
              </button>
            ) : null
          }
        >
          <div className="flex items-center gap-1.5">
            <IconImage size={14} className="shrink-0 text-slate-400" />
            <input
              key={card.image.src ?? ''}
              className="cc-input"
              placeholder="https://… or a data URL"
              defaultValue={card.image.src ?? ''}
              onBlur={(event) => {
                const next = event.target.value.trim()
                if (next !== (card.image.src ?? '')) {
                  setCardImage(card.id, { src: next || null, alt: card.image.alt })
                }
              }}
            />
            <label className="cc-btn shrink-0 cursor-pointer px-2 py-1">
              Upload
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handleUpload(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          <input
            key={card.image.alt}
            ref={altInputRef}
            className="cc-input mt-1.5"
            placeholder="Alt text (for accessibility)"
            defaultValue={card.image.alt}
            onBlur={(event) => {
              if (event.target.value !== card.image.alt) {
                setCardImage(card.id, { src: card.image.src, alt: event.target.value })
              }
            }}
          />
          {card.image.src ? (
            <img
              src={card.image.src}
              alt={card.image.alt}
              className="mt-2 max-h-24 w-full rounded-lg border border-line object-cover"
            />
          ) : null}
        </Section>

        <Section title="Tags">
          <div className="flex flex-wrap gap-1">
            {card.tags.map((tag) => (
              <span key={tag} className="cc-tag">
                #{tag}
                <button
                  type="button"
                  className="ml-0.5 cursor-pointer opacity-60 hover:opacity-100"
                  title="Remove tag"
                  onClick={() => removeTag(card.id, tag)}
                >
                  <IconX size={10} />
                </button>
              </span>
            ))}
          </div>
          <input
            className="cc-input mt-2"
            placeholder="Add a tag and press Enter"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                addTag(card.id, tagDraft)
                setTagDraft('')
              }
            }}
          />
        </Section>

        <Section
          title={`Steps (${card.checklist.filter((item) => item.done).length}/${card.checklist.length})`}
          action={
            <button
              type="button"
              className="cursor-pointer text-[11px] font-semibold text-indigo-600 hover:underline"
              onClick={() => addChecklistItem(card.id, 'New step')}
            >
              + step
            </button>
          }
        >
          {card.checklist.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              No steps yet — or write <code className="cc-inline-code">- [ ] </code> items in the Markdown above.
            </p>
          ) : (
            <ul className="space-y-1">
              {card.checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    checked={item.done}
                    onChange={(event) => updateChecklistItem(card.id, item.id, { done: event.target.checked })}
                  />
                  <input
                    className="cc-input flex-1 py-0.5"
                    defaultValue={item.text}
                    onBlur={(event) => {
                      if (event.target.value !== item.text) {
                        updateChecklistItem(card.id, item.id, { text: event.target.value })
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer p-0.5 text-slate-400 hover:text-red-600"
                    onClick={() => removeChecklistItem(card.id, item.id)}
                  >
                    <IconX size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {childTitles.length > 0 ? (
          <Section title={`Child cards (${childTitles.length})`}>
            <ul className="ml-3 list-disc text-[11.5px] text-slate-600">
              {childTitles.map((title, index) => (
                <li key={`${title}-${index}`}>{title}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  )
}
