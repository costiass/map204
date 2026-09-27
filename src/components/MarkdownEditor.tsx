import { useCallback, useRef, useState } from 'react'

import {
  IconBold,
  IconCode,
  IconHeading,
  IconImage,
  IconItalic,
  IconLink,
  IconList,
  IconQuote,
  IconTask,
} from '@/components/Icons'
import { fileToDataUrl, formatBytes } from '@/utils/image'
import { renderMarkdown } from '@/utils/markdown'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Called when the user stops typing, so the change becomes one undo step. */
  onCommit: () => void
  placeholder?: string
  ariaLabel: string
}

interface Wrap {
  before: string
  after: string
  /** Placeholder used when the selection is empty. */
  hint?: string
  block?: boolean
}

const WRAPS: Array<{ label: string; icon: typeof IconBold; wrap: Wrap }> = [
  { label: 'Heading', icon: IconHeading, wrap: { before: '## ', after: '', hint: 'Heading', block: true } },
  { label: 'Bold', icon: IconBold, wrap: { before: '**', after: '**', hint: 'bold text' } },
  { label: 'Italic', icon: IconItalic, wrap: { before: '*', after: '*', hint: 'italic text' } },
  { label: 'Link', icon: IconLink, wrap: { before: '[', after: '](https://)', hint: 'label' } },
  { label: 'Bullet list', icon: IconList, wrap: { before: '- ', after: '', hint: 'list item', block: true } },
  { label: 'Task', icon: IconTask, wrap: { before: '- [ ] ', after: '', hint: 'to do', block: true } },
  { label: 'Quote', icon: IconQuote, wrap: { before: '> ', after: '', hint: 'quote', block: true } },
  { label: 'Code', icon: IconCode, wrap: { before: '`', after: '`', hint: 'code' } },
]

/** Builds a Markdown image reference for an embedded file. */
function imageMarkdown(src: string, alt: string): string {
  return `![${alt}](${src})`
}

/**
 * Markdown source editor with a live preview.
 *
 * Images can go anywhere: the toolbar button embeds one at the cursor, and
 * pasting an image from the clipboard does the same, so notes stay in Markdown
 * rather than a side-channel image field.
 */
export function MarkdownEditor({
  value,
  onChange,
  onCommit,
  placeholder = 'Write notes in Markdown…',
  ariaLabel,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'write' | 'preview' | 'split'>('split')
  const [busy, setBusy] = useState(false)

  /** Applies a wrap to the current selection, replacing it with the result. */
  const applyWrap = useCallback(
    (wrap: Wrap) => {
      const textarea = textareaRef.current
      if (!textarea) return
      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      if (wrap.block) {
        const result = prefixLines(value, start, end, wrap.before, wrap.hint ?? '')
        onChange(result.value)
        restoreCaret(textarea, result.caret)
        return
      }

      const selected = value.slice(start, end)
      const body = selected || (wrap.hint ?? '')
      onChange(`${value.slice(0, start)}${wrap.before}${body}${wrap.after}${value.slice(end)}`)
      // Land the caret inside the wrapper so typing continues naturally.
      restoreCaret(textarea, start + wrap.before.length + body.length)
    },
    [onChange, value],
  )

  const embedFiles = useCallback(
    async (files: File[]) => {
      const images = files.filter((file) => file.type.startsWith('image/'))
      if (images.length === 0) return
      setBusy(true)
      try {
        const snippets: string[] = []
        for (const file of images) {
          const src = await fileToDataUrl(file)
          snippets.push(imageMarkdown(src, file.name.replace(/\.[a-z0-9]+$/i, '')))
        }
        const textarea = textareaRef.current
        const at = textarea ? textarea.selectionStart : value.length
        const lead = at > 0 && value[at - 1] !== '\n' ? '\n\n' : ''
        const snippet = `${lead}${snippets.join('\n\n')}\n`
        onChange(`${value.slice(0, at)}${snippet}${value.slice(at)}`)
        onCommit()
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
        })
      } finally {
        setBusy(false)
      }
    },
    [onChange, onCommit, value],
  )

  const html = renderMarkdown(value)
  const imageCount = (value.match(/!\[[^\]]*\]\(/g) ?? []).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-1.5">
        <div className="cc-seg">
          <button type="button" data-active={mode === 'write'} onClick={() => setMode('write')}>
            Write
          </button>
          <button type="button" data-active={mode === 'split'} onClick={() => setMode('split')}>
            Split
          </button>
          <button type="button" data-active={mode === 'preview'} onClick={() => setMode('preview')}>
            Preview
          </button>
        </div>
        <span className="ml-auto" />
        <span className="text-[10.5px] text-slate-400">
          {value.length} chars{imageCount > 0 ? ` · ${imageCount} image${imageCount === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1">
        {WRAPS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.label}
              type="button"
              className="cc-btn px-1.5 py-1"
              title={item.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyWrap(item.wrap)}
            >
              <Icon size={13} />
            </button>
          )
        })}
        <button
          type="button"
          className="cc-btn px-1.5 py-1"
          title="Embed an image at the cursor"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => fileRef.current?.click()}
        >
          <IconImage size={13} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            void embedFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        {busy ? <span className="ml-1 text-[10.5px] text-slate-400">embedding…</span> : null}
      </div>

      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: mode === 'split' ? '1fr 1fr' : '1fr' }}>
        {mode !== 'preview' ? (
          <textarea
            ref={textareaRef}
            className="cc-scroll cc-input h-full min-h-[9rem] w-full resize-none rounded-none border-0 border-r border-line font-mono text-[12px] leading-relaxed focus:outline-none"
            value={value}
            placeholder={placeholder}
            spellCheck
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onCommit}
            onPaste={(event) => {
              const images = Array.from(event.clipboardData.files).filter((file) =>
                file.type.startsWith('image/'),
              )
              if (images.length === 0) return
              event.preventDefault()
              void embedFiles(images)
            }}
          />
        ) : null}

        {mode !== 'write' ? (
          <div
            className="cc-scroll cc-markdown min-h-0 overflow-y-auto p-3"
            dangerouslySetInnerHTML={{ __html: html || '<p class="cc-md-empty">Nothing to preview yet.</p>' }}
          />
        ) : null}
      </div>

      <p className="border-t border-line px-3 py-1.5 text-[10.5px] leading-snug text-slate-400">
        Markdown is the storage format — paste or embed images inline, anywhere. Rough size{' '}
        {formatBytes(value.length)} for this body.
      </p>
    </div>
  )
}

/** Prefixes every line touched by the selection (or the current line). */
function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
  fallback: string,
): { value: string; caret: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEndBreak = value.indexOf('\n', end)
  const lineEnd = lineEndBreak === -1 ? value.length : lineEndBreak
  const block = value.slice(lineStart, lineEnd)
  const lines = block.length > 0 ? block.split('\n') : [fallback]

  // A block wrap on a blank line inserts the marker plus a fresh line to type on.
  if (lines.length === 1 && lines[0].trim() === '') {
    return { value: `${value.slice(0, lineStart)}${prefix}\n${value.slice(lineStart)}`, caret: lineStart + prefix.length }
  }

  const updated = lines.map((line) => `${prefix}${line}`).join('\n')
  const firstLineEnd = updated.indexOf('\n') === -1 ? updated.length : updated.indexOf('\n')
  return {
    value: `${value.slice(0, lineStart)}${updated}${value.slice(lineEnd)}`,
    caret: lineStart + firstLineEnd,
  }
}

/** Restores focus and a collapsed caret after a toolbar edit. */
function restoreCaret(textarea: HTMLTextAreaElement, caret: number): void {
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(caret, caret)
  })
}
