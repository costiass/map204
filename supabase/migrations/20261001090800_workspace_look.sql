-- 009 · Give every workspace a colour and an icon
--
-- A workspace is a subject, and subjects are told apart by colour long before
-- they are told apart by name. The workspace list was a grid of identical grey
-- tiles, so twenty courses looked like twenty of the same thing.
--
-- Both values are chosen by the person who owns the workspace and are stored
-- per workspace, so the tile in the list and the dot beside the title in the
-- canvas chrome always agree.
--
-- The colour is a *token name*, not a hex value, for the same reason every
-- other colour in this app is: the theme owns the palette, so a workspace
-- recolours itself when the reader switches to dark mode instead of carrying a
-- fixed colour that reads wrong on the new background.

alter table public.documents
  add column if not exists accent text not null default 'indigo';

alter table public.documents
  add column if not exists icon text not null default 'layout-grid';

-- Both are constrained to the sets the client can actually draw. A check
-- constraint is the only thing that stops a bad value reaching the browser,
-- where an unknown icon would render as an empty box and an unknown accent
-- would fall back to a colour nobody chose.
--
-- The lists here are the single source of truth for what is offered; the client
-- reads them from `src/utils/workspaceLook.ts`, which is generated to match.
alter table public.documents
  drop constraint if exists documents_accent_check;
alter table public.documents
  add constraint documents_accent_check
  check (accent in (
    'indigo', 'violet', 'blue', 'teal', 'green', 'amber', 'rose', 'slate'
  ));

alter table public.documents
  drop constraint if exists documents_icon_check;
alter table public.documents
  add constraint documents_icon_check
  check (icon in (
    'layout-grid', 'book-open', 'graduation-cap', 'flask-conical', 'globe',
    'calculator', 'microscope', 'languages', 'palette', 'music', 'code',
    'map', 'lightbulb', 'presentation', 'brain', 'library'
  ));

-- Give the workspaces that already exist a colour, so opening the list after
-- this migration does not show a wall of identical indigo tiles. Chosen by
-- position rather than at random, so the same workspace keeps its colour.
with numbered as (
  select
    id,
    row_number() over (order by created_at, id) as n
  from public.documents
)
update public.documents d
set accent = case
      when (numbered.n - 1) % 8 = 0 then 'indigo'
      when (numbered.n - 1) % 8 = 1 then 'teal'
      when (numbered.n - 1) % 8 = 2 then 'amber'
      when (numbered.n - 1) % 8 = 3 then 'rose'
      when (numbered.n - 1) % 8 = 4 then 'green'
      when (numbered.n - 1) % 8 = 5 then 'violet'
      when (numbered.n - 1) % 8 = 6 then 'blue'
      else 'slate'
    end
from numbered
where numbered.id = d.id;
