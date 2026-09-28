-- Share a workspace with somebody who has not signed up yet.
--
-- **The gap this closes.** `ShareDialog` looked the address up with
-- `find_profile_by_email` and refused it when there was no row:
--
--   No Map204 account uses that email address.
--
-- So the only people a workspace could be shared with were people who already had
-- an account. That is backwards. Sharing is how somebody finds out Map204 exists,
-- and the person you most want to show a map to is, almost by definition, somebody
-- who has not made an account yet. The share flow was a closed loop that could only
-- reach people already inside it.
--
-- What it does now:
--
--   * An address with no account becomes a *pending invite* -- a row here, keyed on
--     the email rather than on a user id, because there is no user id yet.
--   * The invitation email goes out with a link to sign up.
--   * `claim_pending_invites` turns each matching invite into a real
--     `document_collaborators` row the moment somebody registers with that address,
--     so the workspace is already there when they arrive.
--
-- Keyed on the *email*, not on a token, and that is deliberate. An invite token in
-- the URL would be claimable by whoever forwarded the link, and would need storing,
-- hashing, expiry and a single-use flag. This way the only way to claim one is to
-- prove you own the address, which is exactly what signing in with Google does --
-- Google verifies the address, and Supabase will not hand out a session for an
-- address the person cannot prove.
--
-- A forward migration, because the rule is that an applied migration is never
-- rewritten. The database is being reset for version 2 anyway; this exists so the
-- reset is not the first time this is right.

-- ----------------------------------------------------------------
-- Is this an address at all?
-- ----------------------------------------------------------------
--
-- Deliberately loose: a full RFC 5322 grammar rejects addresses that work. This
-- only catches the two mistakes a typed address actually makes -- no `@`, or an `@`
-- with nothing on one side -- plus whitespace and a trailing full stop.
--
-- Declared here, before the table, because the table's CHECK constraint calls it.
-- The first version of this migration defined it at the bottom, after the table, and
-- as a consequence the column had *no* address check at all: `is_plausible_email`
-- existed, was correct, was referenced by nothing, and `not-an-email` was accepted
-- as an invitation and stored. A helper nobody calls is a comment with a return
-- type.
create or replace function public.is_plausible_email(p_email text)
returns boolean
language sql
immutable
as $$
  select p_email is not null
     and length(p_email) between 3 and 320
     and position('@' in p_email) > 1
     and position('@' in p_email) < length(p_email)
     and p_email !~ '[[:space:]]'
     and p_email !~ '[.,;:]@'
$$;

-- ----------------------------------------------------------------
-- document_invites: a share waiting for its recipient to exist
-- ----------------------------------------------------------------
create table if not exists public.document_invites (
  document_id text not null references public.documents (id) on delete cascade,
  -- Lower-cased on insert and by the check below, because `Bob@example.com` and
  -- `bob@example.com` are one person and two pending invites otherwise -- and the
  -- claim on signup would match only whichever spelling the person registered with.
  --
  -- This check is what makes the claim case-insensitive. `claim_pending_invites`
  -- compares this column against `lower(auth.users.email)`, which only works if
  -- both sides are already lower case. Enforcing it here is cheaper and far more
  -- robust than lower-casing on every comparison, and it fails at the point where
  -- somebody typed the address, which is where the mistake was.
  email text not null check (email = lower(email) and public.is_plausible_email(email)),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  -- One pending invite per person per workspace. Without this, inviting somebody
  -- twice makes two rows, the claim inserts one collaborator row, and the second
  -- invite sits there forever describing a grant that already happened.
  primary key (document_id, email)
);

-- The claim looks up by email alone, across every workspace this person was invited
-- to, so that lookup is the access path and it needs its own index. The primary key
-- leads with `document_id`, which cannot serve it.
create index if not exists document_invites_email_idx
  on public.document_invites (email);

create index if not exists document_invites_document_idx
  on public.document_invites (document_id);

alter table public.document_invites enable row level security;

-- ----------------------------------------------------------------
-- Who can read and write a pending invite
-- ----------------------------------------------------------------
--
-- `can_edit_document` rather than a role check of its own: an invite *is* a grant
-- that has not landed yet, so exactly the people who could make that grant are the
-- people who may make this one. A viewer can do neither, which is why a viewer sees
-- nothing here.
--
-- RLS on a table the browser reads directly, so the policy is not optional: without
-- it the anon key could enumerate every pending invitation in the project, which is
-- a list of email addresses.
create policy document_invites_read on public.document_invites
  for select to authenticated
  using (public.can_edit_document(document_id));

create policy document_invites_write on public.document_invites
  for insert to authenticated
  with check (public.can_edit_document(document_id));

create policy document_invites_update on public.document_invites
  for update to authenticated
  using (public.can_edit_document(document_id))
  with check (public.can_edit_document(document_id));

create policy document_invites_delete on public.document_invites
  for delete to authenticated
  using (public.can_edit_document(document_id));

grant select, insert, update, delete on public.document_invites to authenticated;

-- ----------------------------------------------------------------
-- Claiming, on sign-up
-- ----------------------------------------------------------------
--
-- Turn every invite addressed to `p_email` into a real collaborator row, and drop
-- the invite so it cannot be claimed twice or read as outstanding.
--
-- `on conflict do nothing` because two paths can reach this at once: a person who
-- was already an editor *and* had a stale invite would otherwise fail the whole
-- claim on the conflict and leave their other invites unclaimed.
create or replace function public.claim_pending_invites(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  source_email text;
  claimed integer := 0;
  inv record;
begin
  select lower(a.email) into source_email
  from auth.users a
  where a.id = p_user_id;

  if source_email is null then
    return 0;
  end if;

  ----------------------------------------------------------------
  -- Make sure the profile exists first
  ----------------------------------------------------------------
  --
  -- `document_collaborators.user_id` references `public.profiles(id)`, and the
  -- profile is created by a *different* trigger on `auth.users` -- `trg_sync_profile`.
  --
  -- Postgres runs same-table triggers in name order, and this one is called
  -- `trg_claim_pending_invites`, which sorts before `trg_sync_profile`. So at the
  -- moment this runs the profile does not exist yet, the insert violates the foreign
  -- key, and -- because the caller catches exceptions and turns them into a warning
  -- -- the whole claim fails *silently*: the person signs up, sees no shared
  -- workspace, and nothing anywhere says why.
  --
  -- The obvious fix is to rename this trigger to sort later. That is the wrong fix:
  -- it makes correctness depend on a naming convention that nothing checks, and the
  -- day somebody adds a trigger that wants to run first it breaks again, silently.
  --
  -- So the function is made self-sufficient instead. `sync_profile_for` is an
  -- upsert, so calling it here is a no-op when the profile is already there, and
  -- the claim no longer cares what order the triggers fire in.
  perform public.sync_profile_for(p_user_id);

  -- One by one rather than set-based, because the role has to come from the invite
  -- and a `insert ... select` would have to trust it against the check constraint
  -- rather than read it back.
  for inv in
    select i.document_id, i.role
    from public.document_invites i
    where i.email = source_email
    for update
  loop
    insert into public.document_collaborators (document_id, user_id, role)
    values (inv.document_id, p_user_id, inv.role)
    on conflict (document_id, user_id) do nothing;

    if found then
      claimed := claimed + 1;
    end if;

    delete from public.document_invites i
    where i.document_id = inv.document_id and i.email = source_email;
  end loop;

  return claimed;
end;
$$;

create or replace function public.claim_pending_invites_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- A failure here must not stop the account being created. A person whose invite
  -- cannot be claimed should still end up with an account and be able to fix it;
  -- refusing the sign-up over an invitation would be a far worse outcome than a
  -- share that arrives late.
  begin
    perform public.claim_pending_invites(new.id);
  exception when others then
    raise warning 'pending invites for % could not be claimed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_claim_pending_invites on auth.users;
create trigger trg_claim_pending_invites
  after insert on auth.users
  for each row
  execute function public.claim_pending_invites_on_signup();

-- ----------------------------------------------------------------
-- Invites already waiting, for accounts that exist
-- ----------------------------------------------------------------
--
-- Only for people who are already registered: an invite whose address now belongs
-- to an account should be a live collaborator row, not an outstanding email. This
-- is the case where somebody was invited, then signed up before the trigger above
-- was deployed.
do $$
declare
  inv record;
  claimant uuid;
begin
  for inv in
    select i.document_id, i.email, i.role
    from public.document_invites i
    join auth.users a on lower(a.email) = i.email
  loop
    select a.id into claimant
    from auth.users a
    where lower(a.email) = inv.email
    order by a.created_at
    limit 1;

    insert into public.document_collaborators (document_id, user_id, role)
    values (inv.document_id, claimant, inv.role)
    on conflict (document_id, user_id) do nothing;

    delete from public.document_invites
    where document_id = inv.document_id and email = inv.email;
  end loop;
end;
$$;
