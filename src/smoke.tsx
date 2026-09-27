import { renderToString } from 'react-dom/server'

import App from '@/App'
import { useCanvasStore } from '@/store/useCanvasStore'
import { clearDocument, loadDocument, saveDocument } from '@/store/database'
import { STORAGE_KEY } from '@/store/persistence'
import { installFakeIndexedDB } from '@/smokeIndexedDB'
import { createSampleDoc } from '@/data/sample'
import { fitViewport, screenToWorld, snap, cardRect } from '@/utils/geometry'
import { buildEdgeGeometry } from '@/utils/edges'
import { COLLAPSED_HEADER_HEIGHT, DEFAULT_RELATIONSHIP, DOC_VERSION, type CanvasDoc } from '@/types'
import { parseDoc, serializeDoc } from '@/utils/serialize'
import { htmlToMarkdown, looksLikeHtml, markdownToPlainText, renderMarkdown } from '@/utils/markdown'

const LEGACY_KEY = STORAGE_KEY

export function renderApp(): string {
  return renderToString(<App />)
}

export interface Check {
  label: string
  ok: boolean
  detail?: string
}

export function checkRender(): Check[] {
  // Note: `renderToString` reads zustand's *initial* snapshot, so a store change
  // made before a render will not show up in the markup. Only the state the app
  // boots with can be asserted this way.
  const html = renderApp()
  return [
    { label: 'renders markup', ok: html.length > 500, detail: `${html.length} chars` },
    { label: 'the sidebar starts closed', ok: !html.includes('aria-label="Close sidebar"') },
    { label: 'the sidebar can be toggled', ok: (() => {
      useCanvasStore.getState().setSidebarOpen(true)
      const open = useCanvasStore.getState().sidebarOpen
      useCanvasStore.getState().setSidebarOpen(false)
      return open === true && useCanvasStore.getState().sidebarOpen === false
    })() },
    { label: 'sample cards render', ok: html.includes('Light Reactions') && html.includes('Calvin Cycle') },
    { label: 'connections render', ok: html.includes('cc-edge-line') },
    { label: 'card body renders a markdown preview', ok: html.includes('cc-card__body') && html.includes('<strong>light energy</strong>') },
    { label: 'inline markdown image renders in a card', ok: (html.match(/<img src="data:image\/svg\+xml/g) ?? []).length >= 2 },
    { label: 'inspector is hidden with no selection', ok: !html.includes('Content') || !html.includes('>Content<') },
    { label: 'card body is its own scroll region', ok: html.includes('cc-card__scroll') },
    { label: 'the card title opts out of dragging', ok: /cc-card__title[^>]*data-no-drag/.test(html) },
    { label: 'toolbar renders', ok: html.includes('Zoom') },
  ]
}

export function checkSerialization(): Check[] {
  const doc = createSampleDoc()
  const json = serializeDoc(doc)
  const back = parseDoc(json)
  const originalCards = doc.pages.reduce((sum, page) => sum + page.cards.length, 0)
  const roundTrippedCards = back.doc.pages.reduce((sum, page) => sum + page.cards.length, 0)
  const originalLinks = doc.pages.reduce((sum, page) => sum + page.connections.length, 0)
  const roundTrippedLinks = back.doc.pages.reduce((sum, page) => sum + page.connections.length, 0)

  // A duplicate id must be repaired rather than rejected, and a connection
  // pointing at a missing card must be dropped.
  // Each mutation is applied to its own copy so one repair cannot mask another.
  const dangling = JSON.parse(json) as typeof doc
  dangling.pages[0].connections[0].target = { kind: 'card', id: 'does-not-exist' }
  const repairedDangling = parseDoc(JSON.stringify(dangling))

  const duplicate = JSON.parse(json) as typeof doc
  const oldId = duplicate.pages[0].cards[1].id
  duplicate.pages[0].cards[1].id = duplicate.pages[0].cards[0].id
  const repairedDuplicate = parseDoc(JSON.stringify(duplicate))
  const pageIds = new Set(repairedDuplicate.doc.pages[0].cards.map((card) => card.id))
  const pageLinkTargets = repairedDuplicate.doc.pages[0].connections.flatMap((link) => [
    link.source.id,
    link.target.id,
  ])

  return [
    { label: 'round trip keeps cards', ok: originalCards === roundTrippedCards },
    { label: 'round trip keeps connections', ok: originalLinks === roundTrippedLinks },
    { label: 'round trip is warning free', ok: back.warnings.length === 0, detail: back.warnings.join('; ') },
    { label: 'duplicate ids are repaired', ok: repairedDuplicate.warnings.length > 0 && !repairedDuplicate.doc.pages[0].cards.some((c, i) => i > 0 && c.id === repairedDuplicate.doc.pages[0].cards[0].id) },
    { label: 'duplicate repair keeps every link valid', ok: pageLinkTargets.every((id) => pageIds.has(id)), detail: oldId },
    { label: 'dangling connections dropped', ok: repairedDangling.doc.pages[0].connections.length === doc.pages[0].connections.length - 1, detail: `${doc.pages[0].connections.length} -> ${repairedDangling.doc.pages[0].connections.length}` },
    { label: 'valid JSON is accepted', ok: parseDoc(JSON.stringify(doc)).doc.pages.length === doc.pages.length },
    { label: 'garbage JSON is rejected', ok: (() => {
      try {
        parseDoc('not json at all')
        return false
      } catch {
        return true
      }
    })() },
  ]
}

export function checkGeometry(): Check[] {
  const size = { width: 1200, height: 800 }
  const bounds = { x: 0, y: 0, width: 3000, height: 2000 }
  const viewport = fitViewport(bounds, size, 80)
  const world = screenToWorld({ x: 600, y: 400 }, viewport)
  const centreInView = screenToWorld({ x: size.width / 2, y: size.height / 2 }, viewport)
  const card = createSampleDoc().pages[0].cards[0]
  const rect = cardRect(card)

  return [
    { label: 'fit keeps zoom in range', ok: viewport.zoom >= 0.1 && viewport.zoom <= 2, detail: `zoom ${viewport.zoom.toFixed(3)}` },
    { label: 'fit handles empty bounds', ok: fitViewport(null, size).zoom === 1 },
    { label: 'centre point lands in bounds', ok: centreInView.x >= 0 && centreInView.x <= 3000 && centreInView.y >= 0 && centreInView.y <= 2000 },
    { label: 'screenToWorld inverts a known point', ok: Math.abs(world.x - (600 - viewport.x) / viewport.zoom) < 1e-6 },
    { label: 'card rect honours stored size', ok: Math.abs(rect.width - card.position.width) < 1e-6 && Math.abs(rect.height - card.position.height) < 1e-6 },
    { label: 'snap rounds to the grid', ok: snap(37, 20) === 40 && snap(31, 20) === 40 },
  ]
}

export function checkMarkdown(): Check[] {
  const render = (source: string) => renderMarkdown(source)
  return [
    { label: 'headings render', ok: render('## Limiting factors').includes('<h2>Limiting factors</h2>') },
    { label: 'bold and italic render', ok: render('**b** and *i*').includes('<strong>b</strong>') && render('**b** and *i*').includes('<em>i</em>') },
    { label: 'asterisk italic alone renders', ok: render('*italic*') === '<p><em>italic</em></p>', detail: render('*italic*') },
    { label: 'underscore italic alone renders', ok: render('_italic_') === '<p><em>italic</em></p>', detail: render('_italic_') },
    { label: 'italic inside a sentence renders', ok: render('a *b* c') === '<p>a <em>b</em> c</p>', detail: render('a *b* c') },
    { label: 'bold and italic side by side', ok: render('**bold** and *italic*') === '<p><strong>bold</strong> and <em>italic</em></p>', detail: render('**bold** and *italic*') },
    { label: 'bold and italic on separate lines', ok: render('**bold**\n*italic*') === '<p><strong>bold</strong>\n<em>italic</em></p>', detail: render('**bold**\n*italic*') },
    { label: 'two italics on one line', ok: render('*a* and *b*') === '<p><em>a</em> and <em>b</em></p>', detail: render('*a* and *b*') },
    { label: 'italic in a list item', ok: render('- one *two*') === '<ul class="cc-md-list"><li>one <em>two</em></li></ul>', detail: render('- one *two*') },
    { label: 'italic in a heading', ok: render('## *h*') === '<h2><em>h</em></h2>', detail: render('## *h*') },
    { label: 'intra-word underscores are left alone', ok: render('snake_case_name') === '<p>snake_case_name</p>', detail: render('snake_case_name') },
    { label: 'multiplication is not italic', ok: render('2 * 3 * 4 = 24') === '<p>2 * 3 * 4 = 24</p>', detail: render('2 * 3 * 4 = 24') },
    { label: 'an unclosed asterisk stays literal', ok: render('2 * 3') === '<p>2 * 3</p>', detail: render('2 * 3') },
    { label: 'bold still wins over italic', ok: render('**b**') === '<p><strong>b</strong></p>' },
    { label: 'italic inside bold', ok: render('**b *i***') === '<p><strong>b <em>i</em></strong></p>', detail: render('**b *i***') },
    { label: 'bold inside italic', ok: render('*a **b** c*') === '<p><em>a <strong>b</strong> c</em></p>', detail: render('*a **b** c*') },
    { label: 'italic inside bold with a tail', ok: render('**a *b* c**') === '<p><strong>a <em>b</em> c</strong></p>', detail: render('**a *b* c**') },
    { label: 'triple markers nest as both', ok: render('***both***') === '<p><em><strong>both</strong></em></p>', detail: render('***both***') },
    { label: 'underscore bold renders', ok: render('__bold__') === '<p><strong>bold</strong></p>', detail: render('__bold__') },
    { label: 'two underscore italics', ok: render('_a_ and _b_') === '<p><em>a</em> and <em>b</em></p>', detail: render('_a_ and _b_') },
    { label: 'a line of markers is a rule', ok: render('***') === '<hr />' && render('---') === '<hr />', detail: render('***') },
    { label: 'a lone marker in a sentence stays literal', ok: render('a * b') === '<p>a * b</p>', detail: render('a * b') },
    { label: 'emphasis in a link label', ok: render('[*notes*](a.md)').includes('href="a.md"') && render('[*notes*](a.md)').includes('<em>notes</em>'), detail: render('[*notes*](a.md)') },
    { label: 'card links opt out of dragging', ok: render('[x](a.md)').includes('data-no-drag=""') },
    { label: 'markers inside code stay literal', ok: render('`*not em*`') === '<p><code>*not em*</code></p>', detail: render('`*not em*`') },
    { label: 'strikethrough renders', ok: render('~~old~~').includes('<del>old</del>') },
    { label: 'bullet list renders', ok: render('- one\n- two').includes('<li>one</li>') && render('- one\n- two').includes('cc-md-list') },
    { label: 'ordered list renders', ok: render('1. first').includes('<ol>') },
    { label: 'task list renders with state', ok: render('- [x] done\n- [ ] todo').includes('data-done="true"') && render('- [x] done\n- [ ] todo').includes('data-done="false"') },
    { label: 'quote and rule render', ok: render('> note').includes('<blockquote>') && render('---').includes('<hr />') },
    { label: 'fenced code stays literal', ok: render('```\n<b>x</b>\n```').includes('&lt;b&gt;x&lt;/b&gt;') && !render('```\n<b>x</b>\n```').includes('<b>x</b>') },
    { label: 'remote image renders', ok: render('![alt](https://x.test/a.png)').includes('<img src="https://x.test/a.png" alt="alt"') },
    { label: 'embedded data url image renders', ok: render('![p](data:image/png;base64,iVBOR)').includes('src="data:image/png;base64,iVBOR"') },
    { label: 'image inline in a list item', ok: render('- see ![d](data:image/png;base64,AA) here').includes('<li>see <img') },
    { label: 'javascript: image is refused', ok: !render('![x](javascript:alert(1))').includes('<img') },
    { label: 'html data url image is refused', ok: !render('![x](data:text/html,<b>)').includes('<img') },
    { label: 'raw script html is escaped', ok: render('<script>alert(1)</script>').includes('&lt;script&gt;') && !render('<script>alert(1)</script>').includes('<script>') },
    { label: 'inline event handler is escaped', ok: !render('<img src=x onerror="alert(1)">').includes('<img') && render('<img src=x onerror="alert(1)">').includes('&lt;img') },
    { label: 'javascript: link is refused', ok: !render('[x](javascript:alert(1))').includes('href') },
    { label: 'safe link opens externally', ok: render('[x](https://x.test)').includes('href="https://x.test"') && render('[x](https://x.test)').includes('rel="noreferrer noopener"'), detail: render('[x](https://x.test)') },
    { label: 'a colon-free relative link is allowed', ok: render('[x](notes.md)').includes('href="notes.md"') },
    { label: 'a data: link is refused', ok: !render('[x](data:text/html,<b>)').includes('href') },
    { label: 'a vbscript: link is refused', ok: !render('[x](vbscript:msgbox)').includes('href') },
    { label: 'plain text is untouched', ok: markdownToPlainText('Light & dark') === 'Light & dark' },
    { label: 'plain text drops list markers', ok: markdownToPlainText('## Title\n- one\n- two') === 'Title one two' },
    { label: 'plain text keeps image alt', ok: markdownToPlainText('![diagram](a.png)').includes('diagram') },
    { label: 'plain text keeps link label', ok: markdownToPlainText('see [the notes](a.md)').includes('the notes') },
  ]
}

export function checkLegacyMigration(): Check[] {
  return [
    { label: 'legacy html is detected', ok: looksLikeHtml('<p>hi</p>') && !looksLikeHtml('## hi') },
    { label: 'legacy html converts to markdown', ok: htmlToMarkdown('<p>Light <strong>and</strong> dark</p>') === 'Light **and** dark' },
    { label: 'legacy lists convert', ok: htmlToMarkdown('<ul><li>one</li><li>two</li></ul>') === '- one\n- two' },
    { label: 'legacy ordered lists keep their numbering', ok: htmlToMarkdown('<ol><li>one</li><li>two</li></ol>') === '1. one\n2. two' },
    { label: 'a converted list stays one list', ok: !htmlToMarkdown('<ul><li>one</li><li>two</li></ul>').includes('\n\n') },
    { label: 'a converted list still renders as a list', ok: renderMarkdown(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).includes('<li>one</li><li>two</li>') },
    { label: 'legacy links convert', ok: htmlToMarkdown('<a href="a.md">the notes</a>') === '[the notes](a.md)' },
    { label: 'legacy images convert in either attribute order', ok: htmlToMarkdown('<img src="a.png" alt="d">') === '![d](a.png)' && htmlToMarkdown('<img alt="d" src="a.png">') === '![d](a.png)' },
    { label: 'a converted list stays one list', ok: !htmlToMarkdown('<ul><li>one</li><li>two</li></ul>').includes('\n\n') },
    { label: 'markdown is left alone', ok: htmlToMarkdown('already **markdown**') === 'already **markdown**' },
  ]
}

export function checkDefaults(): Check[] {
  const store = useCanvasStore.getState()
  const pageId = store.activePageId
  const cardsOf = () => useCanvasStore.getState().doc.pages.find((page) => page.id === pageId)?.cards ?? []
  const linksOf = () => useCanvasStore.getState().doc.pages.find((page) => page.id === pageId)?.connections ?? []

  const wanted = {
    backgroundColor: '#FFEDD5',
    accentColor: '#22C55E',
    textColor: '#431407',
    borderColor: '#FED7AA',
    borderWidth: 4,
    borderRadius: 22,
    shadow: false,
  }

  useCanvasStore.getState().setDefaultCardStyle(wanted)
  const storedDefault = useCanvasStore.getState().doc.settings.defaultCardStyle
  const newCardId = useCanvasStore.getState().addCard()
  const newCard = cardsOf().find((c) => c.id === newCardId)

  const targetId = cardsOf().find((c) => c.id !== newCardId)?.id ?? ''
  useCanvasStore
    .getState()
    .setDefaultConnectionPreset({ style: { color: '#EF4444', lineStyle: 'dotted' }, relationshipType: '' })
  const linkId = useCanvasStore.getState().addConnection({
    source: { kind: 'card', id: newCardId },
    target: { kind: 'card', id: targetId },
  })
  const newLink = linksOf().find((c) => c.id === linkId)

  // The defaults must travel with an exported file.
  const exported = parseDoc(serializeDoc(useCanvasStore.getState().doc)).doc

  useCanvasStore.getState().resetDefaultStyles()
  const afterReset = useCanvasStore.getState().doc.settings.defaultCardStyle
  const afterResetRelationship = useCanvasStore.getState().doc.settings.defaultRelationshipType
  useCanvasStore.getState().deleteCards([newCardId])
  if (linkId) useCanvasStore.getState().deleteConnections([linkId])

  return [
    { label: 'setDefaultCardStyle stores the style', ok: newCard?.style.backgroundColor === wanted.backgroundColor && storedDefault.borderWidth === 4 },
    { label: 'new cards inherit the default style', ok: newCard !== undefined && JSON.stringify(newCard.style) === JSON.stringify(wanted), detail: newCard ? JSON.stringify(newCard.style) : 'no card' },
    { label: 'explicit style still wins', ok: (() => {
      const id = useCanvasStore.getState().addCard({ style: { ...wanted, backgroundColor: '#FFFFFF' } })
      const created = cardsOf().find((c) => c.id === id)
      useCanvasStore.getState().deleteCards([id])
      return created?.style.backgroundColor === '#FFFFFF' && created?.style.accentColor === wanted.accentColor
    })() },
    { label: 'new connections inherit the default style', ok: newLink?.style.color === '#EF4444' && newLink?.style.lineStyle === 'dotted' },
    { label: 'a "no relationship" default is honoured', ok: newLink?.relationshipType === '' },
    { label: 'a relationship default is honoured', ok: (() => {
      useCanvasStore.getState().setDefaultConnectionPreset({ relationshipType: 'depends on' })
      const id = useCanvasStore.getState().addConnection({ source: { kind: 'card', id: targetId }, target: { kind: 'card', id: newCardId } })
      const created = linksOf().find((c) => c.id === id)
      if (id) useCanvasStore.getState().deleteConnections([id])
      return created?.relationshipType === 'depends on'
    })() },
    { label: 'defaults survive export/import', ok: JSON.stringify(exported.settings.defaultCardStyle) === JSON.stringify(wanted) && exported.settings.defaultConnectionStyle.lineStyle === 'dotted' && exported.settings.defaultRelationshipType === '' },
    { label: 'an older file with no relationship default still loads', ok: (() => {
      const legacy = parseDoc(JSON.stringify({ version: DOC_VERSION, pages: [], settings: {} })).doc
      return legacy.settings.defaultRelationshipType === DEFAULT_RELATIONSHIP
    })() },
    { label: 'resetDefaultStyles restores the factory style', ok: afterReset.backgroundColor === '#FFFFFF' && afterReset.borderWidth === 1 && afterResetRelationship === DEFAULT_RELATIONSHIP },
  ]
}

export function checkCollapsedLinks(): Check[] {
  const store = useCanvasStore.getState()
  const pageId = store.activePageId
  const page = () => useCanvasStore.getState().doc.pages.find((p) => p.id === pageId)
  const cards = () => page()?.cards ?? []

  const source = cards()[0]
  const target = cards()[1]
  if (!source || !target) return [{ label: 'sample has two cards to test', ok: false }]

  const geometry = () =>
    buildEdgeGeometry({
      source: cardRect(cards()[0]),
      target: cardRect(cards()[1]),
      sourceAnchor: null,
      targetAnchor: null,
      routing: 'curved',
      arrowStart: 'none',
      arrowEnd: 'arrow',
      width: 2,
    })
  const before = geometry()

  useCanvasStore.getState().toggleCollapsed([source.id])
  const after = geometry()
  const storedRect = cardRect(cards()[0])
  const drawnHeight = cards()[0].collapsed ? COLLAPSED_HEADER_HEIGHT : storedRect.height

  useCanvasStore.getState().toggleCollapsed([source.id])

  return [
    { label: 'collapsing keeps the stored size', ok: cards()[0].position.height === source.position.height },
    {
      label: 'collapsing does not move the link',
      ok: before.start.x === after.start.x && before.start.y === after.start.y && before.end.x === after.end.x && before.end.y === after.end.y,
    },
    { label: 'the collapsed card is drawn shorter than the link', ok: drawnHeight < storedRect.height, detail: `${drawnHeight} vs ${storedRect.height}` },
  ]
}

export function checkStore(): Check[] {
  const store = useCanvasStore.getState()
  const pageId = store.activePageId
  const cardsOf = () => useCanvasStore.getState().doc.pages.find((page) => page.id === pageId)?.cards ?? []
  const linksOf = () => useCanvasStore.getState().doc.pages.find((page) => page.id === pageId)?.connections ?? []
  const before = cardsOf().length

  const createdId = useCanvasStore.getState().addCard()
  const added = cardsOf().length

  useCanvasStore.getState().updateCard(createdId, { title: 'Smoke card' })
  const renamed = cardsOf().find((card) => card.id === createdId)

  const targetId = cardsOf()[0]?.id ?? ''
  const linkId = useCanvasStore.getState().addConnection({
    source: { kind: 'card', id: createdId },
    sourceAnchor: 'top',
    target: { kind: 'card', id: targetId },
    targetAnchor: 'bottom',
  })
  const links = linksOf().length

  useCanvasStore.getState().undo()
  const afterUndo = linksOf().length
  useCanvasStore.getState().redo()
  const afterRedo = linksOf().length

  useCanvasStore.getState().deleteCards([createdId])
  const afterDelete = cardsOf().length

  return [
    { label: 'addCard creates one card', ok: added === before + 1, detail: `${before} -> ${added}` },
    { label: 'updateCard renames', ok: renamed?.title === 'Smoke card' },
    { label: 'addConnection links two cards', ok: Boolean(linkId) && links === before + 1, detail: `${links} links` },
    { label: 'self connections are rejected', ok: useCanvasStore.getState().addConnection({ source: { kind: 'card', id: targetId }, sourceAnchor: 'top', target: { kind: 'card', id: targetId }, targetAnchor: 'bottom' }) === null },
    { label: 'undo reverts the link', ok: afterUndo === links - 1, detail: `${links} -> ${afterUndo}` },
    { label: 'redo restores the link', ok: afterRedo === links },
    { label: 'deleteCards cleans up connections', ok: afterDelete === before, detail: `${afterDelete} vs ${before}` },
  ]
}


/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * Exercises the persistence layer against an in-memory stand-in for IndexedDB
 * (`smokeIndexedDB.ts`): the localStorage fallback, migration of an existing
 * JSON file, and — most importantly — that a save rewrites only the records
 * that actually changed.
 */
export async function checkDatabase(): Promise<Check[]> {
  const checks: Check[] = []
  const sample = createSampleDoc()

  // 1. IndexedDB refused: the app keeps working on the old JSON file.
  globalThis.indexedDB = {
    open: () => {
      throw new DOMException('storage is blocked', 'SecurityError')
    },
  } as unknown as IDBFactory
  localStorage.setItem(LEGACY_KEY, serializeDoc(sample))
  const fallbackSave = await saveDocument(sample)
  const fallbackLoad = await loadDocument()
  checks.push(
    { label: 'falls back to local storage when IndexedDB is refused', ok: fallbackSave.ok && fallbackSave.storage === 'localstorage' },
    { label: 'the fallback reads the document back', ok: fallbackLoad.doc?.pages.length === sample.pages.length && fallbackLoad.storage === 'localstorage' },
  )
  localStorage.removeItem(LEGACY_KEY)

  // 2. A working database adopts whatever was in the JSON file.
  const fake = installFakeIndexedDB()
  fake.reset()
  localStorage.setItem(LEGACY_KEY, serializeDoc(sample))
  const migrated = await loadDocument()
  checks.push(
    { label: 'migrates the old JSON document into the database', ok: migrated.storage === 'database' && migrated.doc !== null && migrated.doc.pages.length === sample.pages.length },
    { label: 'the migrated document is stored intact', ok: migrated.doc !== null && serializeDoc(migrated.doc) === serializeDoc(sample) },
    { label: 'the JSON file is no longer the store', ok: fake.dump('cardcanvas', 'pages').length === sample.pages.length },
  )
  localStorage.removeItem(LEGACY_KEY)

  const base = migrated.doc ?? sample

  // 3. Nothing edited means nothing written.
  const noop = await saveDocument(base)
  checks.push({
    label: 'an unchanged save writes nothing',
    ok: noop.ok && noop.pages === 0 && noop.bytes === 0,
  })

  // 4. One page edited: one record rewritten, everything else left alone.
  // The documents below are built the way Immer builds them for the store — a
  // new object only where something changed — because that object identity is
  // exactly what the save is allowed to look at.
  const target = Math.min(1, base.pages.length - 1)
  const edited: CanvasDoc = {
    ...base,
    pages: base.pages.map((page, index) =>
      index === target
        ? { ...page, cards: page.cards.map((card, cardIndex) => (cardIndex === 0 ? { ...card, title: 'Renamed by the storage test' } : card)) }
        : page,
    ),
  }
  const partial = await saveDocument(edited)
  const reloaded = await loadDocument()
  checks.push(
    { label: 'an edit rewrites only the page that changed', ok: partial.ok && partial.pages === 1, detail: `${partial.pages} page` },
    { label: 'the edit comes back on reload', ok: reloaded.doc?.pages[target].cards[0].title === 'Renamed by the storage test' },
    { label: 'pages keep their order in the list', ok: reloaded.doc?.pages.map((page) => page.id).join() === edited.pages.map((page) => page.id).join() },
    { label: 'the storage-only order field never reaches the document', ok: reloaded.doc?.pages.every((page) => !('order' in page)) === true },
  )

  // 5. Reordering the page list moves records, deleting one drops it.
  const moved = edited.pages[0]
  const reordered: CanvasDoc = { ...edited, pages: [...edited.pages.slice(1), moved] }
  const orderWrite = await saveDocument(reordered)
  const afterOrder = await loadDocument()
  checks.push(
    { label: 'moving a page rewrites both records', ok: orderWrite.ok && orderWrite.pages === 2, detail: `${orderWrite.pages} pages` },
    { label: 'the new order is read back', ok: afterOrder.doc?.pages[afterOrder.doc.pages.length - 1].id === moved.id },
  )

  const trimmed: CanvasDoc = { ...reordered, pages: reordered.pages.filter((page) => page.id !== moved.id) }
  const deleteWrite = await saveDocument(trimmed)
  const afterDelete = await loadDocument()
  checks.push({
    label: 'deleting a page removes its record',
    ok:
      deleteWrite.ok &&
      afterDelete.doc?.pages.length === trimmed.pages.length &&
      !afterDelete.doc?.pages.some((page) => page.id === moved.id),
  })

  // 6. Settings live in their own record.
  const restyled: CanvasDoc = {
    ...trimmed,
    settings: {
      ...trimmed.settings,
      defaultCardStyle: { ...trimmed.settings.defaultCardStyle, backgroundColor: '#FFE4E6' },
      defaultRelationshipType: '',
    },
  }
  const settingsWrite = await saveDocument(restyled)
  const afterSettings = await loadDocument()
  checks.push(
    { label: 'a settings-only change writes one record and no page', ok: settingsWrite.ok && settingsWrite.pages === 0 && (settingsWrite.bytes ?? 0) > 0, detail: `${settingsWrite.bytes} bytes` },
    { label: 'settings survive the round trip', ok: afterSettings.doc?.settings.defaultCardStyle.backgroundColor === '#FFE4E6' && afterSettings.doc?.settings.defaultRelationshipType === '' },
  )

  // 7. An empty database hands the app nothing, so it can show the sample.
  await clearDocument()
  const empty = await loadDocument()
  checks.push({
    label: 'an empty database reports no document',
    ok: empty.doc === null && empty.error === undefined && fake.dump('cardcanvas', 'pages').length === 0,
  })

  return checks
}
