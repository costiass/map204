-- Fill `invited_by` from the session instead of demanding it from the client.
--
-- **Why sharing with somebody who has no account failed.**
--
--   null value in column "invited_by" of relation "document_invites"
--   violates not-null constraint
--
-- The column was declared `not null references auth.users(id)` with no default, and
-- the client inserts the three fields it knows -- document, email, role -- and knows
-- nothing about `invited_by` at all. So every insert failed, which meant the
-- feature this migration was for did not work at all: sharing with an address that
-- has no account refused, with a database error rather than anything a person could
-- act on.
--
-- It is not fixed by having the client send the user id, and that is the more
-- interesting half.
--
-- `invited_by` is a fact about *who did this*, and the only trustworthy source for
-- it is the session the request arrives with. A client that supplies the value can
-- supply any value: an editor -- or anything holding the public anon key, since that
-- is public by design -- could record an invitation as having come from the owner,
-- and the share list would then name somebody who never invited anybody. A column
-- that answers "who?" must be answered by the database, and the session is the
-- database's own record of who is asking.
--
-- So the client sends three fields and never a fourth, and this trigger fills in the
-- rest. A `before insert` rather than a default, because `auth.uid()` is not allowed
-- in a `default` expression and the value has to come from the session rather than
-- from a constant.
--
-- A forward migration, because 010 has been applied -- the error above is how we
-- know.

create or replace function public.set_invited_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `auth.uid()` is null for the service role and for a direct psql session. Both
  -- are legitimate ways to put a row in -- a repair script, a migration backfill --
  -- so they are allowed through with the column left alone, and the NOT NULL below
  -- is what stops one arriving from a session-less *client* request, which is the
  -- case that actually happened.
  if auth.uid() is not null then
    new.invited_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_invited_by on public.document_invites;
create trigger trg_set_invited_by
  before insert on public.document_invites
  for each row
  execute function public.set_invited_by();

-- ----------------------------------------------------------------
-- Rows inserted before this, which could not have been
-- ----------------------------------------------------------------
--
-- There cannot be any: the column was NOT NULL, so every attempt failed and left
-- nothing behind. Stated rather than assumed, because a backfill here that assumed
-- it was wrong would insert rows nobody invited.

-- ----------------------------------------------------------------
-- And an explanation, for anybody who reads this column later
-- ----------------------------------------------------------------
comment on column public.document_invites.invited_by is
  'The account that sent the invitation. Filled from auth.uid() by trg_set_invited_by; '
  'clients do not supply it, so it cannot be forged by one.';

-- ----------------------------------------------------------------
-- What this cannot check
-- ----------------------------------------------------------------
--
-- That the trigger fires on a request from a signed-in editor. The signup test
-- inserts as the table owner with no session, which is the other branch -- and this
-- file's own purpose is that the first branch was missing.
