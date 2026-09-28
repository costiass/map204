# Migration work order — v1 cards to v2 elements

A list to follow in order. Each step names the file, the anchor to search for, and
what "done" looks like. No step requires a decision.

**The app builds and runs today on v1.** Nothing here is a bug fix; it is a
document format change.

**The build is red from the moment Phase A lands, and stays red until Phase G.**
`.cards` → `.elements` is a type error against a still-v1 `Page`. So Phase A and
Phase B are one atomic unit: there is no point between them where the tree
compiles, and no value in stopping there. A red build is the expected state for
everything between; the only rule is that you do not *stop* while it is red.

Where you can get green again part-way, take it — the reorderable checkpoints are
listed at the end.

## Where things are

| Done and tested | Not started |
| --- | --- |
| `src/elements/schema.ts` — the v2 union | `GroupEditor` — 18, groups lost their nested groups |
| `src/elements/defaults.ts` | `MultiSelectEditor` — 18 |
| `src/elements/serialize.ts` — normalize/create v2 | `InsertCardDialog` — 17, built on the deleted v1 model |
| `src/elements/registry.ts` — kinds, icons, flags | `Canvas` — 14, the interaction layer |
| `src/elements/migrate.ts` — v1 → v2 for import | `data/sample.ts` — 14, the tutorial as a v1 doc |
| `src/store/elementOps.ts` — every operation | `ConnectionEditor`, `ContextMenu` — 11 each |
| `scripts/test-elements.cjs` | 10 more components |
| `scripts/test-element-ops.cjs` | the migrations, the storage bucket |
| **A + B + C + D** — renames, types, library, store | |
| **E** — the v1 writers are gone | |

**196 errors remain, every one of them in `src/components/`.** `types.ts`, the
store, `utils/`, `hooks/`, `data/` and the whole `elements/` library typecheck
clean. The remaining work is one directory.

## What Phase E actually removed

- `createCard`, `createGroup`, `createConnection` (v1) → the v2 constructors
- `normalizeDoc` (v1, 350 lines) → `migrateToV2` + `normalizeDoc` (v2)
- `cloneDoc` — dead
- `applySnapshot` — moved to a `PageContent` shape that says `elements`
- `CARD_TYPES`, `isCardType`, `guessCardType`, `embedFor` — **a fourth copy of the
  list of kinds**, now `elements/registry`'s job alone
- `Page.position` → `Page.ordinal` (the column that was always there)

Three bugs fell out of it rather than being looked for:

- `usePageSync` hardcoded `version: 1` in a hydration call.
- `merge.ts`'s dangling-connection check compared endpoints against `'card'`,
  which v2 renamed to `'element'` — so *every* connection would have been
  discarded on a union merge, silently.
- `filters.ts` searched `card.content`; a note's field is `body`.

---

# Four bugs the rewrite found in working code

None of these were introduced by the migration. All four were in code that
typechecked, passed its tests, and shipped — and three of them were found only
because a v1-era test suite was rewritten against the v2 shape and the new
assertions disagreed with the old ones.

That is the argument for rewriting tests when you rewrite the model: a test that
passes proves the code does what it did, not that it does what it should.

### 1. Every camera transition had a duration of zero

```ts
durationMs: oneOf(raw.transition, ['instant'], 'ease') ? 0 : clamp(...)
```

`oneOf` returns the **value**, not a boolean. `'ease'` is a truthy string, so the
condition was true for every step that had a transition — which is all of them.
Every presentation step was given a duration of `0`, and the camera cut between
steps instead of moving. A cut is not obviously wrong, so nothing reported it.

Fixed to `raw.transition === 'instant' ? 0 : ...`. The lesson is in a comment
there now, because `oneOf(...)` in a condition looks correct to anyone who has
not read its signature.

### 2. Every flash deck in every document was empty

The rename pass turned `value.cards` into `value.elements` inside the flash
normalizer — the one collision the plan warned about, reached anyway. The
normalizer read a page's elements where a deck's cards live, found none, and
produced a deck with one blank card. Every flash card in every document became
two empty rectangles.

**This is why `test:card-types` existed and why it had to be rewritten rather
than deleted.** The old assertions could not have caught it: they read
`card.type` and `card.embed`, neither of which exists on a flash *element*. The
new ones read `cards[0][0].text`.

### 3. An unrecognised `targetKind` flew the camera at nothing

A step naming a kind the app does not recognise became an `element` step that
kept its `targetId`. The camera would then centre on an object that does not
exist. It is now an establishing shot with no target, which is what version 1
did.

### 4. A card with a `parentId` loses it silently

**Fixed.** The migration now reports it, and the report is specific about what
happened and what to do: the card is still there, put it in a group.

The check has to be two-sided, and the second half is the interesting one. A
`parentId` that a group *also* claims is not lost — the containment survives by
the other mechanism — and warning about it would be noise about a document that
is fine. So `test:migrate-v2` asserts both: the warning fires for an orphan, and
stays silent when a group accounts for it.

## The rule these four make worth keeping

**A test that cannot fail is not a test.** The flash bug survived a suite whose
assertions referenced fields the bug had removed. A passing test proves the code
does what it did; only an assertion about the *right* thing proves it does what
it should.

---

# Phase A — the rename pass

Mechanical. Nothing here needs judgement, which is why it is a script and not a
list of edits.

### A1. Write `scripts/rename-v1-to-v2.cjs`

**Only these rules. Each is a pure rename with no judgement in it:**

```js
const RENAMES = [
  [/\.cards\b/g, '.elements'],          // a page holds elements
  [/\bmemberCardIds\b/g, 'memberIds'],  // "card" outlived what it named
  [/\bdefaultCardStyle\b/g, 'defaultNoteStyle'],
  [/\bselectedCardIds\b/g, 'selectedElementIds'],
  [/kind === 'card'/g, "kind === 'element'"],
  [/kind: 'card'/g, "kind: 'element'"],
  [/\bsourceCardId\b/g, 'sourceElementId'],
  [/\btargetCardId\b/g, 'targetElementId'],
  [/\bprimaryCardId\b/g, 'primaryElementId'],
  [/\.position\.x\b/g, '.x'],            // geometry is flat in v2, for
  [/\.position\.y\b/g, '.y'],            // elements *and* groups — which is
  [/\.position\.width\b/g, '.width'],    // the first sign the flattening
  [/\.position\.height\b/g, '.height'],  // was the right call
  [/\.position\.zIndex\b/g, '.zIndex'],
]
```

**Only these paths.** An explicit list, not a glob — the glob is how a rename
reaches a file it has no business touching:

```
src/store/useCanvasStore.ts
src/store/supabase-sync.ts
src/components/*.tsx
src/hooks/*.ts
src/data/sample.ts
```

**Never `src/elements/`.** Three reasons, all learned the hard way:

- `migrate.ts` must keep reading the **v1** names (`rawPage.cards`,
  `memberCardIds`, `defaultCardStyle`). That is its entire job. Renaming it
  produces a migration that compiles and converts nothing.
- `serialize.ts` and `elementOps.ts` are already v2.

### A2. Run it, then measure

```
node scripts/rename-v1-to-v2.cjs
npx tsc -b --noEmit
```

Expect roughly **250 errors**, down from ~430. If you see more, a rule over-reached
— `git diff --stat` and look at what changed.

---

# Phase B — `src/types.ts`

The keystone. Every consumer imports `Page` from here, so until this flips nothing
else can start.

### B1. Remove the old `DOC_VERSION`

Search: `export const DOC_VERSION = 1` → delete the line. It is re-exported from
the schema now.

### B2. Delete the v1 document block

From the line `export interface ChecklistItem {` to the closing `}` of
`export interface CanvasDoc {`. That is `ChecklistItem`, `CardImage`,
`CardPosition`, `CardStyle`, `CardType`, `CardEmbed`, `Card`, `GroupPosition`,
`Group`, `ConnectionStyle`, `ConnectionEndpoint`, `Connection`, `Page`,
`StepTransition`, `StepTrigger`, `StepFocus`, `PresentationStep`, `DocSettings`,
`CanvasDoc`.

Do not delete `Point`, `Rect`, `Viewport`, `Anchor`, `LineStyle`, `ArrowStyle`,
`Routing`, `GridPattern` — they are the canvas's, not the document's.

### B3. Add the re-export, in the same place

```ts
export { DOC_VERSION, MAX_UPLOAD_BYTES } from '@/elements/schema'
export type {
  CanvasDocV2 as CanvasDoc, Connection, ConnectionStyle, DocSettings,
  Element, ElementKindName, FlashElement, FlashSide, Group, LinkElement,
  NoteChecklistItem as ChecklistItem, NoteElement, NoteStyle as CardStyle,
  Page, PdfElement, PresentationStepV2 as PresentationStep, RefDisplay,
  StepFocusV2 as StepFocus, StepTransitionV2 as StepTransition,
  StepTriggerV2 as StepTrigger, StoredFile, TableColumn, TableElement,
  VideoDisplay, VideoElement,
} from '@/elements/schema'

export type ConnectionEndpoint = { kind: 'element' | 'group'; id: string }
```

### B4. Replace the defaults block

From `export const DEFAULT_CARD_STYLE` to the end of the file. It becomes
`createDefaultSettings` and `createDefaultStep`, unchanged, plus a **local
import** — a re-export is not in the file's own scope, which is a confusing
error the first time:

```ts
import { DEFAULT_CONNECTION_STYLE_V2 as DEFAULT_CONNECTION_STYLE,
         DEFAULT_NOTE_STYLE as DEFAULT_CARD_STYLE } from '@/elements/defaults'
import type { DocSettings, PresentationStepV2 as PresentationStep } from '@/elements/schema'
export { DEFAULT_CONNECTION_STYLE_V2 as DEFAULT_CONNECTION_STYLE,
         DEFAULT_NOTE_STYLE as DEFAULT_CARD_STYLE, DEFAULT_VIDEO_ASPECT } from '@/elements/defaults'
```

Keep `NO_RELATIONSHIP`, `DEFAULT_RELATIONSHIP`, `MIN_CARD_BORDER_WIDTH`,
`MAX_CARD_BORDER_WIDTH` — add them back if B2 took them.

### B5. Check

```
npx tsc -b --noEmit 2>&1 | findstr /c:"types.ts"
```

**Zero lines.** If `types.ts` still errors, B2/B4 are incomplete. Everything
else is expected to be red.

---

# Phase C — repair the v2 files the rename touched

Only if Phase A's path list was followed this should be empty. Check anyway.

- `src/store/elementOps.ts`, in `cloneElement`: `copy.elements` → `copy.cards`.
  A flash element has its **own** `cards` — the deck — and `.cards` → `.elements`
  renamed both.
- `src/elements/serialize.ts`, the `'flash'` case of `createElement`:
  `input.elements` → `input.cards`, same reason.
- `src/elements/migrate.ts`: if it reads `rawPage.elements` or
  `rawGroup.memberIds`, it has been broken. It must read `rawPage.cards` and
  `rawGroup.memberCardIds`.

### C1. Every `FlashElement` needs `cardIndex`

Added to the schema, three builders were missed. Search `kind: 'flash'` in
`serialize.ts` (twice) and `migrate.ts` (once) and add `cardIndex: 0` next to
`showing:`.

### C2. Check

```
npm run test:elements && npm run test:element-ops && npm run test:migrate-v2
```

All three must pass **before** continuing. They are the only thing currently
protecting the v2 files.

---

# Phase D — the store *(done)*

`src/store/useCanvasStore.ts`. The store **is** the middle of this change; there
is no subset of it that compiles alone.

### D1. Imports

Replace the type import block with the v2 names, and add:

```ts
import { createElement, type ElementKind } from '@/elements/serialize'
import {
  addElementToGroup as addElementToGroupOps, applyZOrder as applyZOrderOps,
  applyPatch, deleteElements as deleteElementsOps, deleteGroups as deleteGroupsOps,
  duplicateElements as duplicateElementsOps, editNote, findElement,
  moveElements as moveElementsOps, moveGroupWithMembers, placeElement,
  removeElementFromGroup as removeElementFromGroupOps,
  resizeElement as resizeElementOps, resizeGroupMembers,
  setTableCell as setTableCellOps, toggleCollapsed as toggleCollapsedOps,
  type ZOrderMode,
} from '@/store/elementOps'
```

### D2. The action signatures

Replace the `/* --- cards --- */` block with the element equivalents. Every name
changes: `addElement`, `updateElement`, `moveElements`, `resizeElement`,
`duplicateElements`, `deleteElements`, `applyElementZOrder`,
`toggleElementCollapsed`, `selectElements`, `toggleElementSelection`,
`selectAllElements`.

**Delete:** `setCardParent`, `updateCardStyle`, `commitCardPositions`,
`resizeCard`, `duplicateCards`, `deleteCards`, `applyZOrder`, `toggleCollapsed`,
`setCardImage`, `commitGroupPositions`, `addCardToGroup`, `removeCardFromGroup`,
`addGroupToGroup`, `removeGroupFromGroup`, `selectCards`, `toggleCardSelection`,
`selectAllCards`.

**Rename:** `setCardImage` → `setNoteImage`. **Add:** `setTableCell`,
`stepFlashDeck`, `setFlashFacing`, `addFlashCard`, `removeFlashCard`.

`resizeElement` takes `options?: { aspect?: number | null; leading?: 'width' | 'height' }`.

### D3. The element slice

Replace the body from `addCard:` to just before the connections banner. Each
action is a thin wrapper over `elementOps` — the logic is already written and
tested, and duplicating it here is how the two drift.

### D4. The group slice

`addGroup` builds with **flat** x/y/width/height, not a nested `position`.
`moveGroups` calls `moveGroupWithMembers`. `resizeGroup` captures
`{ x, y, width, height }` **before** changing them, then calls
`resizeGroupMembers`.

### D5. Selection

`selectedElementIds` throughout. `applyRemotePage` drops `page.position` and
`setActivePage` clears `selectedElementIds`.

### D6. `deleteSelection`

`deleteElements`, `deleteConnections`, `deleteGroups` — by the new names.

### D7. Check

```
npx tsc -b --noEmit 2>&1 | findstr /c:"useCanvasStore"
```

Zero. If there is more, it is a leftover `card.` or `.position.` — search for
both in this file.

---

# Phase E — the v1 writers *(done)*

Still the v1 writers. Nearly all of it is now dead.

- Delete `createCard`, `createCard` helpers, `normalizeCard`, and the v1
  `normalizeSteps`/`normalizeSettings` — v2 has its own in `elements/`.
- Keep `createConnection`, `createGroup` if the store still calls them, otherwise
  move them and delete.
- Keep `htmlToMarkdown` handling for a note's `body`.

---

# Phase F — the consumers *(done — the build is green)*

**0 type errors. `npm test` passes. `npm run build` is clean.**

Two were not mechanical:

- **`CardNode` → `ElementNode`.** One component, `switch` on `element.kind`
  inside an `ElementBody`, with the shared interaction in the chrome around it.
  The chrome — title bar, collapse, menu, four connection handles, resize grip,
  drag — is written once and every kind gets it. Only the body varies, so adding
  a kind is a `case` plus a body.
- **`usePageSync`** broadcasts `page.elements`. Both ends renamed together.

## What the component pass turned up

Beyond the three restored features above:

**A note's fields are note-only, and the components assumed otherwise.** Nine
sites reached for `element.style`, `element.tags`, `element.content` or
`element.checklist` on whatever they were handed. In v2 those exist on a note and
nowhere else. The fix is not a cast — it is that the inspector now *routes by
kind*: a note gets `CardContentTab`/`CardSettingsTab`, everything else gets
`ElementInspectorTab`, which asks the one question that kind actually has.

**A note's `parentId` is gone, and three things were built on it.** `Canvas`
derived "which cards are inside this card" and showed a *Child cards* list;
`CardContentTab` did the same; `CardSettingsTab` had a *Parent card* dropdown.
All three now come from group membership, so the nesting a card displays is the
nesting a group defines — one mechanism, no second opinion.

**`CardLinkSection` is deleted.** It edited a card's optional `embed`, which is
how a *note* could point at a YouTube video and a *video card* could point
somewhere else. In v2 there is no embed to edit.

**`FlashCard` became `FlashDeck`.** A deck is a list of cards, so the component
now takes a `FlashElement`, renders `cards[cardIndex]`, and steps through the
deck from *both* faces — a deck you can only advance from the question is a deck
you cannot revise.

**`createElement` now refuses a kind it does not implement, loudly.** It took a
`string` so that a menu iterating the registry needs no cast, and the old
`default` case silently made a note out of anything. It now warns: the registry
marks unimplemented kinds as unsupported, so a menu ignoring that gets a console
message instead of a note titled "Table" that nobody can get back.

**`DevOverlay` is gone.**

---

# Phase G — the rest

- `src/data/sample.ts` — the sample is a v1 document. Easiest by running
  `migrateToV2` over it at load time rather than rewriting it by hand.
- `src/store/supabase-sync.ts` — `DEFAULT_DOC_SETTINGS` uses `defaultNoteStyle`.
- `src/components/PresentOverlay.tsx`, `PresentationInspector.tsx` — steps now
  name `'element'`, not `'card'`.

---

# Phase H — verify

```
npx tsc -b --noEmit
npx oxlint
npm test
npm run build
node scripts/test-encoding.cjs
```

**Then run the app.** This is the step a typecheck cannot do for you: twenty
files were changed by rename, and renames are exactly the kind of change that
compiles and is wrong.

Check by hand: a note with text, a video, a flash deck, a group with three
elements in it, a link between two, move a group, resize a group, resize a video
(it must keep its shape), collapse a note, undo, reload the page.

---

# Phase I — the database *(not started; two things to know first)*

## The upload quota is declared and not enforced

`MAX_UPLOAD_BYTES` is 50Mb in the schema and is re-exported from two modules.
**Nothing imports it.** The limit exists as a constant, which is documentation
rather than a limit, and `test:bundle` asserts its *absence* so that the day it
is enforced the suite fails and says why.

The check is the upload function *and* the bucket policy. One enforced only in a
browser is one that can be skipped — and a quota in the schema protects nobody.

## The by-hand check could not be done here

No browser is attached to this session, so the app was verified as far as a shell
can: every module transforms and serves, the dev server returns 200, and
`test:bundle` parses the built output and asserts the v2 model is in it.

That cannot see whether a video resizes to the right shape, or whether a group's
members follow it. `test:bundle`'s own header says so. **Phase I should not start
until someone has actually clicked through it.**

Last, and only after Phase H.

- Rewrite the six migrations for a clean database.
- `supabase bootstrap`.
- The tutorial content, as v2 elements.
- The storage bucket, an RLS policy keyed to document ownership, and a
  signed-URL endpoint. The 50Mb quota is checked in the upload function **and** by
  the bucket policy — one enforced only in a browser is one that can be skipped.

---

# Three features v2 had dropped, and Phase F put back

The v2 schema was written before the components were read. Going through the UI
turned up three things it had removed that were **implemented, offered in the
editor, and used in the bundled sample**. All three are restored.

A schema is a record of what the product supports. Narrowing it during a data
migration is how a migration quietly deletes a feature — and because the
*renderer* still understood the old values, nothing failed visibly. Each of
these would have looked like "the app got simpler" rather than "the app lost
something".

| Dropped | Restored because |
| --- | --- |
| `arrowStart`/`arrowEnd` lost `triangle` and `diamond` | `utils/edges.ts` draws all five. A list narrower than the renderer replaces the missing ones with a default, so a diamond arrowhead came back as a plain arrow on the next save. |
| `routing: 'stepped'` → only `orthogonal` was accepted on input | The migration read only the new name, so **every stepped connection in every saved document became a curve**. The renderer was fine; the reader was wrong. |
| `Connection.sourceAnchor` / `targetAnchor` removed | The renderer falls back to `autoAnchors` on `null`; the editor offered a four-way picker per end; the sample set anchors on all seven connections. Dropping them redraws the whole tutorial on first open, and every edge still looks *fine*. |

`test-sample` now asserts that the tutorial's anchors survived, because
"every connection still looks correct" is exactly what a lost anchor looks like.

The one remaining narrowing in the schema — v2's `routing` being named
`orthogonal` rather than `stepped` — was kept. It is a rename, not a removal, and
the migration now translates between the two.

---

# Three decisions the migration made, that need a ruling

These are not mechanical. Each one drops or changes a capability, and each was
made by the type system rather than chosen. The code is written; the decision is
not settled. These are the things to overrule if you disagree.

### 1. A group can no longer contain a group

`memberGroupIds` is gone; `addGroupToGroup` / `removeGroupFromGroup` are deleted.

The specific case still works: `groupContaining` picks the **innermost**
containing group, so dropping an element inside two nested frames puts it in the
inner one. What is lost is moving the outer frame and having the inner one travel
with it.

**The cost of reversing it** is a `Group[]` inside a `Group` plus a second
containment rule. Worth asking whether "the outer group holds the inner one" is
something anyone actually does, or whether innermost-wins is what they wanted
from it anyway.

### 2. `setCardParent` is gone

v1 had two ways to contain a thing: a group's bounds, and a card's `parentId`.
They could disagree — a card with a `parentId` nowhere near the group that
"contained" it. v2 keeps one mechanism.

**The migration drops `parentId` silently.** That is the actual defect, not the
removal. A v1 document where a card was parented but sat inside no group loses
that relationship with no warning. `migrateToV2` returns a warning for every
other lossy case; it should say this one too.

### 3. Groups now carry their members, and that changes drag

Moving a group moves what is inside it. In v1 the frame moved and the contents
stayed, re-deriving membership on every pointer-move by testing each element
against the bounds.

The new behaviour is right — but it is a **change users will feel**, and it
interacts with the removed auto-detection: membership is now explicit rather than
inferred from position. An element dragged halfway out of a group stays a member,
where before it would have dropped out.

Whether membership should still be inferred on drop is a real product question,
and `groupContaining` is the tested function for it.

---

# The wire is not the model

The single most dangerous fact about this migration, and the one place where a
rename silently destroys data instead of failing to compile.

**The in-memory shape is `Page.elements`. The database column is `cards`.** The
`pages` table has a column named `cards`, and the `import_pages` RPC reads
`page -> 'cards'` out of its JSONB argument. Those are still true, and they stay
true until Phase I renames the column — which is what the database reset is for.

So in `supabase-sync.ts` and `usePageSync.ts`, a `.cards` that looks like v1 is
often **correct**: it is the wire.

```ts
createPage:  cards: page.elements   // in-memory -> wire: right
rowToPage:   cards: asArray(row.cards)  // wire -> in-memory: also right
```

A rule that renames bare `cards:` keys to `elements:` makes `rowToPage` read
`row.elements` off a row whose column is `cards`. That is `undefined` becoming
`[]` — every page's contents replaced by nothing. The type checker accepts it,
because `PageRow` is a local interface and the rename changed both sides of it.
It only fails against a live database, by discarding data.

This is the reason the rename script has a comment where a rule is *missing*. A
list of things not to do is load-bearing information; do not delete the comment
thinking it is stale.

---

# Where you can get green again

Three points in the middle of the red stretch where the build compiles and the app
runs. If you need somewhere to stop, these are the places.

- **After Phase C.** The v2 files are self-consistent again, but nothing consumes
  them yet, so this is the state the app is in *today* plus the tested v2 library.
  It is where the last attempt reverted to, and it was the right call.
- **After Phase E.** `utils/serialize.ts` is gone, so the v1 writers are gone. The
  store compiles if the store is done; components are the remainder.
- **After Phase G.** Fully green. `npm test` and the app are the real check.

A revert to "After Phase C" is always safe and costs you the work since. A revert
from anywhere else needs the phases redone, because the files are interdependent.

---

# Traps, all of them paid for

1. **Never rename inside `src/elements/`.** `migrate.ts` reads v1 names; renaming
   it produces a migration that compiles and converts nothing.
2. **`.cards` → `.elements` also hits a flash deck.** A flash element has its own
   `cards`. Two different meanings, one rule.
3. **A blanket `Card` → `Element` made errors go up**, 289 → 302. `Card` is a
   type, a word in prose, and a flash card's side.
4. **A re-export is not in the file's own scope.** `export { X } from` plus a
   function whose signature names `X` needs an `import` as well.
5. **A guard that passes vacuously is worse than no guard.** The z-order test
   passed with `break` added; the case that catches it needs a *gapped*
   selection, because every other case needs one swap or none.
6. **Do not run the app on a red build.** The half-migrated state is where
   mistakes hide, and "mostly clean" is not a state to trust.
