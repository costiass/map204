-- Backup every workspace, before you reset the database.
--
-- Run this in the Supabase SQL Editor and save the result. It returns one row
-- per workspace, with a `json` column that is a valid Map204 export file, so
-- each one can be re-imported through the app afterwards.
--
-- Why this exists rather than "use the Export button": export carries pages, but
-- not the workspace's own name, colour or icon. A reset deletes the workspace
-- row, and with it the name. This includes it, so a restore puts back what you
-- had rather than a set of pages called "Imported page".
--
-- Nothing here is destructive. It is a read.

select
  d.id,
  json_build_object(
    'version', 1,
    'document', json_build_object(
      'title', d.title,
      'accent', d.accent,
      'icon', d.icon
    ),
    'pages', coalesce((
      select json_agg(
        json_build_object(
          'id', p.id,
          'title', p.title,
          'position', p.position,
          'viewport', p.viewport,
          'cards', p.cards,
          'groups', p.groups,
          'connections', p.connections,
          'createdAt', p.created_at,
          'updatedAt', p.updated_at
        ) order by p.ordinal
      )
      from public.pages p
      where p.document_id = d.id
    ), '[]'::json),
    'settings', coalesce(d.settings, '{}'::json)
  ) as export_file
from public.documents d
order by d.created_at;

-- Also worth saving: who had access to what, so a restore can put sharing back.
select
  d.title as workspace,
  coalesce(ou.email, dc_user.email) as person,
  case when d.owner_id = dc.user_id then 'owner' else dc.role end as role
from public.document_collaborators dc
join public.documents d on d.id = dc.document_id
left join auth.users ou on ou.id = d.owner_id
left join auth.users dc_user on dc_user.id = dc.user_id
order by d.title, role;
