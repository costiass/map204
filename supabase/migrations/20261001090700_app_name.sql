-- 008 · Name the app in its own welcome content
--
-- 005 shipped the tutorial workspace with the old product name in the card
-- titles. Editing 005 in place would be wrong if it has already been applied —
-- Postgres would never re-run it — so the text is corrected here instead, and
-- 005 is left as the immutable record of what first shipped.
--
-- The rename is deliberately narrow: only pages belonging to a workspace still
-- called `tutorial` that still carry the old copy. A tutorial the user has
-- renamed, deleted or edited is left exactly as they left it.

update public.pages p
set title = 'Welcome to Map204',
    cards = jsonb_set(
      jsonb_set(
        cards,
        '{0,title}',
        '"Welcome to Map204"'::jsonb
      ),
      '{0,content}',
      to_jsonb('This workspace is yours to change. Rename it, delete it, or add pages beside it.' || chr(10) || chr(10) || 'Everything you do is saved to your account and shared with whoever you invite.'::text)
    )
where exists (
        select 1 from public.documents d
        where d.id = p.document_id
          and d.title = 'tutorial'
      )
  and p.cards->0->>'id' = 'tut_welcome'
  and p.cards->0->>'title' = 'Welcome to ClassCards';
