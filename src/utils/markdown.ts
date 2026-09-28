/**
 * A small, dependency-free Markdown renderer.
 *
 * Map204 stores card bodies as Markdown, which is also the document
 * format, so an image is just a Markdown image wherever you like:
 *
 *     ![diagram](https://example.com/x.png)
 *     ![pasted](data:image/png;base64,iVBORw0KG...)
 *
 * The renderer escapes ALL input first and only ever emits tags it built
 * itself, so raw HTML in the source is displayed as text and can never
 * execute. That is what lets card content skip a separate sanitiser.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SAFE_IMAGE_SRC = /^(https?:\/\/|\/|\.{1,2}\/|data:image\/(png|jpe?g|gif|webp|avif|svg\+xml|bmp)[;,]|blob:)/i
const SAFE_LINK_SCHEME = /^(?:https?:\/\/|mailto:|tel:|#|\/|\.{1,2}\/)/i

/** Allows remote, relative and embedded images; blocks `javascript:` and HTML data URLs. */
export function isSafeImageSrc(src: string): boolean {
  return SAFE_IMAGE_SRC.test(src.trim())
}

/**
 * Allows normal navigation targets: a known scheme, or a relative path such as
 * `notes.md`. A relative path has no colon in it at all, which is what keeps
 * `javascript:` and `data:` payloads out.
 */
export function isSafeLinkHref(href: string): boolean {
  const value = href.trim()
  if (value === '') return false
  if (SAFE_LINK_SCHEME.test(value)) return true
  return !value.includes(':')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/* ------------------------------------------------------------------ */
/* Inline                                                              */
/* ------------------------------------------------------------------ */

const INLINE_PATTERN = new RegExp(
  [
    // `code` (any run of backticks)
    '(`+)([\\s\\S]*?)\\1',
    // ![alt](src "title")
    '!\\[([^\\]]*)\\]\\(\\s*([^\\s)]+)(?:\\s+"([^"]*)")?\\s*\\)',
    // [text](href "title")
    '\\[([^\\]]*)\\]\\(\\s*([^\\s)]+)(?:\\s+"([^"]*)")?\\s*\\)',
    // ~~strike~~
    '~~([\\s\\S]+?)~~',
    // <https://example.com>
    '<((?:https?://|mailto:)[^\\s>]+)>',
  ].join('|'),
  'g',
)

interface InlineToken {
  code?: string
  imageAlt?: string
  imageSrc?: string
  imageTitle?: string
  linkText?: string
  linkHref?: string
  linkTitle?: string
  strike?: string
  autolink?: string
}

/** Links carry `data-no-drag` so clicking one on a card opens it instead of dragging the card. */
const LINK_ATTRS = 'target="_blank" rel="noreferrer noopener" data-no-drag=""'

function renderInlineToken(token: InlineToken): string {
  if (token.code !== undefined) return `<code>${escapeHtml(decodeEntities(token.code.trim()))}</code>`

  if (token.imageSrc !== undefined) {
    const src = decodeEntities(token.imageSrc)
    // An unsafe source still shows the alt text, so nothing silently vanishes.
    if (!isSafeImageSrc(src)) return escapeHtml(token.imageAlt ?? '')
    const title = token.imageTitle ? ` title="${escapeHtml(decodeEntities(token.imageTitle))}"` : ''
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(token.imageAlt ?? '')}"${title} loading="lazy" />`
  }

  if (token.linkHref !== undefined) {
    const href = decodeEntities(token.linkHref)
    const text = renderInline(token.linkText ?? '')
    if (!isSafeLinkHref(href)) return text
    const title = token.linkTitle ? ` title="${escapeHtml(decodeEntities(token.linkTitle))}"` : ''
    return `<a href="${escapeHtml(href)}" ${LINK_ATTRS}${title}>${text}</a>`
  }

  if (token.strike !== undefined) return `<del>${renderInline(token.strike)}</del>`
  if (token.autolink !== undefined) {
    const href = decodeEntities(token.autolink)
    return `<a href="${escapeHtml(href)}" ${LINK_ATTRS}>${escapeHtml(href)}</a>`
  }

  return ''
}

function renderInline(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0
    // Emphasis is resolved separately so `*x*` is never confused with `**x**`.
    out += renderEmphasis(text.slice(last, index))
    out += renderInlineToken({
      code: match[1] !== undefined ? match[2] : undefined,
      imageAlt: match[3],
      imageSrc: match[4],
      imageTitle: match[5],
      linkText: match[6],
      linkHref: match[7],
      linkTitle: match[8],
      strike: match[9],
      autolink: match[10],
    })
    last = index + match[0].length
  }
  out += renderEmphasis(text.slice(last))
  return out
}

/* ------------------------------------------------------------------ */
/* Emphasis: *italic*, **bold**, ***both***                            */
/* ------------------------------------------------------------------ */

/**
 * A run of `*` or `_` only opens or closes emphasis when it sits on the right
 * side of the word (CommonMark's "flanking" rules). That is what keeps
 * `snake_case_name` and `2 * 3 * 4` from turning into italics.
 */
const PUNCTUATION = /[\p{P}\p{S}]/u

interface TextNode {
  kind: 'text'
  value: string
}

interface HtmlNode {
  kind: 'html'
  value: string
}

interface DelimiterNode {
  kind: 'delim'
  char: '*' | '_'
  /** Original run length, needed by the "rule of three". */
  length: number
  /** Delimiters still available to be consumed by a pair. */
  used: number
  canOpen: boolean
  canClose: boolean
}

type InlineNode = TextNode | HtmlNode | DelimiterNode

function tokenizeEmphasis(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let buffer = ''

  const flush = () => {
    if (buffer === '') return
    nodes.push({ kind: 'text', value: buffer })
    buffer = ''
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char !== '*' && char !== '_') {
      buffer += char
      continue
    }

    let length = 0
    while (text[index + length] === char) length += 1
    flush()

    const before = index > 0 ? text[index - 1] : ''
    const after = index + length < text.length ? text[index + length] : ''
    // The start and end of the line count as whitespace.
    const beforeSpace = before === '' || /\s/.test(before)
    const afterSpace = after === '' || /\s/.test(after)
    const beforePunctuation = before !== '' && PUNCTUATION.test(before)
    const afterPunctuation = after !== '' && PUNCTUATION.test(after)

    const leftFlanking = !afterSpace && (!afterPunctuation || beforeSpace || beforePunctuation)
    const rightFlanking = !beforeSpace && (!beforePunctuation || afterSpace || afterPunctuation)

    nodes.push({
      kind: 'delim',
      char,
      length,
      used: length,
      // `_` never emphasises in the middle of a word, `*` always may.
      canOpen: char === '*' ? leftFlanking : leftFlanking && (!rightFlanking || beforePunctuation),
      canClose: char === '*' ? rightFlanking : rightFlanking && (!leftFlanking || afterPunctuation),
    })

    index += length - 1
  }

  flush()
  return nodes
}

/** "Rule of three": 1+2, 2+1 and 3+3 may pair, but 1+2 the other way round may not. */
function blockedByRuleOfThree(opener: DelimiterNode, closer: DelimiterNode): boolean {
  if ((opener.length + closer.length) % 3 !== 0) return false
  return !(opener.length % 3 === 0 && closer.length % 3 === 0)
}

function emitInlineNodes(nodes: InlineNode[], from: number, to: number): string {
  const end = Math.min(to, nodes.length)
  let out = ''
  for (let index = from; index < end; index += 1) {
    const node = nodes[index]
    if (node.kind === 'text') out += escapeHtml(node.value)
    else if (node.kind === 'html') out += node.value
    else out += node.char.repeat(node.used)
  }
  return out
}

/**
 * Pairs delimiters from the inside out, closest first, so `**b *i***` becomes
 * `<strong>b <em>i</em></strong>` and a leftover `*` is left as literal text.
 * The node list is rewritten in place.
 */
function resolveEmphasis(nodes: InlineNode[], from: number, to: number): void {
  let index = from
  let end = Math.min(to, nodes.length)

  while (index < end) {
    // Splicing below shrinks the list, so the range shrinks with it.
    end = Math.min(end, nodes.length)
    let closerIndex = -1
    for (let scan = index; scan < end; scan += 1) {
      const node = nodes[scan]
      if (node.kind === 'delim' && node.used > 0 && node.canClose) {
        closerIndex = scan
        break
      }
    }
    if (closerIndex === -1) return

    const closer = nodes[closerIndex] as DelimiterNode
    let openerIndex = -1
    for (let scan = closerIndex - 1; scan >= from; scan -= 1) {
      const node = nodes[scan]
      if (
        node.kind === 'delim' &&
        node.used > 0 &&
        node.canOpen &&
        node.char === closer.char &&
        !blockedByRuleOfThree(node, closer)
      ) {
        openerIndex = scan
        break
      }
    }

    if (openerIndex === -1) {
      // Nothing can close here, so this run stays literal for good.
      closer.canClose = false
      continue
    }

    const opener = nodes[openerIndex] as DelimiterNode
    const take = Math.min(2, opener.used, closer.used)

    resolveEmphasis(nodes, openerIndex + 1, closerIndex)
    const inner = emitInlineNodes(nodes, openerIndex + 1, closerIndex)
    opener.used -= take
    closer.used -= take

    const wrapped = take === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`
    // Only the inner run is replaced; leftover delimiters stay as literal text
    // on the opener and closer nodes that survive the splice.
    nodes.splice(openerIndex + 1, closerIndex - openerIndex - 1, { kind: 'html', value: wrapped })
    index = openerIndex + 1
  }
}

function renderEmphasis(text: string): string {
  if (!/[*_]/.test(text)) return escapeHtml(text)
  const nodes = tokenizeEmphasis(text)
  resolveEmphasis(nodes, 0, nodes.length)
  return emitInlineNodes(nodes, 0, nodes.length)
}

/* ------------------------------------------------------------------ */
/* Blocks                                                              */
/* ------------------------------------------------------------------ */

const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED = /^([-*+])\s+(.*)$/
const ORDERED = /^\d{1,9}[.)]\s+(.*)$/
const TASK = /^\[([ xX])\]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const FENCE = /^(```|~~~)\s*([\w-]*)\s*$/
const RULE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/

interface ListItem {
  /** Already-rendered inline HTML. */
  html: string
  /** `true` for `- [ ]` / `- [x]` items, which render as a disabled checkbox. */
  task?: boolean
  done?: boolean
}

interface ListContext {
  ordered: boolean
  items: ListItem[]
}

function renderList(context: ListContext): string {
  const tag = context.ordered ? 'ol' : 'ul'
  const className = context.ordered ? '' : ' class="cc-md-list"'
  const items = context.items
    .map((item) =>
      item.task
        ? `<li class="cc-md-task" data-done="${item.done ? 'true' : 'false'}">` +
          `<span class="cc-md-box" aria-hidden="true">${item.done ? '✓' : ''}</span>${item.html}</li>`
        : `<li>${item.html}</li>`,
    )
    .join('')
  return `<${tag}${className}>${items}</${tag}>`
}

/** Renders a Markdown document to a safe HTML string. */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return ''

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []

  let paragraph: string[] = []
  let list: ListContext | null = null
  let quote: string[] = []
  let fence: { marker: string; language: string } | null = null
  let code: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    html.push(`<p>${renderInline(paragraph.join('\n'))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    html.push(renderList(list))
    list = null
  }
  const flushQuote = () => {
    if (quote.length === 0) return
    html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`)
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const line of lines) {
    // Fenced code: everything until the closing fence is literal.
    if (fence) {
      if (line.trimEnd() === fence.marker) {
        const language = fence.language ? ` class="language-${escapeHtml(fence.language)}"` : ''
        html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`)
        fence = null
        code = []
      } else {
        code.push(line)
      }
      continue
    }

    const fenceMatch = line.match(FENCE)
    if (fenceMatch) {
      flushAll()
      fence = { marker: fenceMatch[1], language: fenceMatch[2] ?? '' }
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    if (RULE.test(line)) {
      flushAll()
      html.push('<hr />')
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      flushAll()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      continue
    }

    const quoteMatch = line.match(QUOTE)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      quote.push(quoteMatch[1])
      continue
    }

    const unordered = line.match(UNORDERED)
    if (unordered) {
      flushParagraph()
      flushQuote()
      const task = unordered[2].match(TASK)
      if (task) {
        const item: ListItem = {
          html: renderInline(task[2]),
          task: true,
          done: task[1].toLowerCase() === 'x',
        }
        if (list && !list.ordered) list.items.push(item)
        else {
          flushList()
          list = { ordered: false, items: [item] }
        }
        continue
      }
      if (list && !list.ordered) list.items.push({ html: renderInline(unordered[2]) })
      else {
        flushList()
        list = { ordered: false, items: [{ html: renderInline(unordered[2]) }] }
      }
      continue
    }

    const ordered = line.match(ORDERED)
    if (ordered) {
      flushParagraph()
      flushQuote()
      if (list && list.ordered) list.items.push({ html: renderInline(ordered[1]) })
      else {
        flushList()
        list = { ordered: true, items: [{ html: renderInline(ordered[1]) }] }
      }
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  }

  if (fence) {
    // Unterminated fence: emit what we have rather than swallowing it.
    const language = fence.language ? ` class="language-${escapeHtml(fence.language)}"` : ''
    html.push(`<pre><code${language}>${escapeHtml(code.join('\n'))}</code></pre>`)
  }
  flushAll()

  return html.join('')
}

/* ------------------------------------------------------------------ */
/* Plain text (search, snippets)                                       */
/* ------------------------------------------------------------------ */

/**
 * Flattens Markdown to searchable text. Image alt text and link labels are
 * kept, so a card mentioning "diagram" in `![diagram](…)` is still findable.
 */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return ''
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<(?:https?:\/\/|mailto:)[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/^\s*\[[ xX]\]\s+/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ------------------------------------------------------------------ */
/* Legacy migration                                                    */
/* ------------------------------------------------------------------ */

const LEGACY_HTML = /^\s*<\s*(p|div|ul|ol|li|h[1-6]|strong|b|em|i|span|br)\b/i

/**
 * Older documents stored card bodies as HTML. Detect that shape and convert
 * the common tags to Markdown so an existing file does not render as raw tags.
 * Best effort only — unknown markup degrades to its text content.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return ''

  // Numbered lists need a counter, so they are converted before the plain
  // `<li>` rule turns everything else into bullets.
  let text = html.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, body: string) => {
    let index = 0
    return `\n\n${body.replace(/<li[^>]*>/gi, () => `\n${++index}. `)}\n\n`
  })

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    // Lists first: each item opens its own line, and the wrapper just separates
    // the list from the surrounding text.
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:ul|ol)[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(/<h1[^>]*>/gi, '# ')
    .replace(/<h2[^>]*>/gi, '## ')
    .replace(/<h3[^>]*>/gi, '### ')
    .replace(/<blockquote[^>]*>/gi, '> ')
    // Read attributes off the whole tag so `src` and `alt` work in any order.
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, inner: string) => {
      const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]
      const label = inner.trim()
      if (!href) return label || ''
      return label ? `[${label}](${href})` : `<${href}>`
    })
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>/gi, '<$1>')
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
      const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
      return src ? `![${alt}](${src})` : alt
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    // Keep a converted list tight; a blank line would split it into two lists.
    .replace(/\n{2,}- /g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Balanced pairs only; unbalanced ones would render as literal text.
  text = text.replace(/\*\*([\s\S]*?)\*\*/g, (_m, inner: string) =>
    inner.includes('**') ? inner : `**${inner.trim()}**`,
  )
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, (_m, lead: string, inner: string) =>
    inner.includes('*') ? `${lead}${inner}` : `${lead}*${inner.trim()}*`,
  )

  return text
}

/** True when the stored body looks like legacy HTML rather than Markdown. */
export function looksLikeHtml(content: string): boolean {
  return LEGACY_HTML.test(content)
}
