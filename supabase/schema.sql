-- Huat Huat · Supabase schema
--
-- Run this in your project's SQL editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Every statement is guarded, so it is safe to re-run over an
-- earlier version: `ledgers` is left exactly as it was.
--
-- The model, in one paragraph:
--
--   Each person has their own private ledger, stored as a single JSON document.
--   Two people can form a household. Entries flow from a personal ledger into
--   the household's shared book automatically, EXCEPT entries in categories
--   their owner marked private — those never leave the personal ledger. So the
--   default is shared and privacy is opt-in per category, which is the way
--   round that matches how people actually keep a joint book.
--
--   Shared entries are rows, not a second JSON document, so two people adding
--   at the same time cannot overwrite each other.

-- ===========================================================================
-- 1. Personal ledgers
-- ===========================================================================

create table if not exists public.ledgers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb       not null,
  device     text,
  updated_at timestamptz not null default now()
);

comment on table public.ledgers is
  'One private ledger document per user. Never visible to anyone else.';

-- ===========================================================================
-- 2. Households
-- ===========================================================================

create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null default 'Our ledger',
  created_by uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- A membership can exist before the person does: you invite an email address,
-- and the row is claimed when somebody signs in with it.
create table if not exists public.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  user_id      uuid        references auth.users (id) on delete cascade,
  email        text        not null,
  display_name text,
  color        text,
  role         text        not null default 'Full access',
  status       text        not null default 'invited',  -- invited | active
  created_at   timestamptz not null default now()
);

-- Lower-cased, so Sam@x.com and sam@x.com cannot both be invited.
create unique index if not exists household_members_household_email_idx
  on public.household_members (household_id, lower(email));

create unique index if not exists household_members_household_user_idx
  on public.household_members (household_id, user_id)
  where user_id is not null;

-- ===========================================================================
-- 3. Shared entries
-- ===========================================================================
--
-- One row per transaction a member's ledger has shared. `source_tx_id` is the
-- transaction's id in the author's own ledger, so re-sharing an edited entry
-- updates the existing row instead of duplicating it.

create table if not exists public.shared_entries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  author_id    uuid        not null references auth.users (id) on delete cascade,
  source_tx_id text        not null,
  tx           jsonb       not null,
  updated_at   timestamptz not null default now()
);

create unique index if not exists shared_entries_source_idx
  on public.shared_entries (household_id, author_id, source_tx_id);

create index if not exists shared_entries_household_idx
  on public.shared_entries (household_id);

-- ===========================================================================
-- 4. updated_at is the server's to set
-- ===========================================================================
--
-- Two browsers resolving a conflict need to trust the same clock. A client
-- timestamp can be wrong (a laptop with a skewed clock) or dishonest, so the
-- database stamps every write itself.

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ledgers_touch_updated_at on public.ledgers;
create trigger ledgers_touch_updated_at
  before insert or update on public.ledgers
  for each row execute function public.touch_updated_at();

drop trigger if exists shared_entries_touch_updated_at on public.shared_entries;
create trigger shared_entries_touch_updated_at
  before insert or update on public.shared_entries
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- 5. Membership helper
-- ===========================================================================
--
-- SECURITY DEFINER on purpose. A policy on household_members that itself reads
-- household_members would recurse and Postgres would refuse it. This function
-- runs as its owner, breaking that cycle. It is deliberately narrow: it answers
-- one yes/no question about the *calling* user and leaks nothing else.

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from household_members m
    where m.household_id = hid
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

-- ===========================================================================
-- 6. Row level security
-- ===========================================================================
--
-- This is what actually protects the data. The publishable key in the page is
-- public by design; these policies are the reason one user cannot read
-- another's ledger. Without them the tables are readable by anyone holding it.

alter table public.ledgers           enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.shared_entries    enable row level security;

-- --- personal ledgers: strictly your own ---------------------------------
drop policy if exists "read own ledger"   on public.ledgers;
drop policy if exists "insert own ledger" on public.ledgers;
drop policy if exists "update own ledger" on public.ledgers;
drop policy if exists "delete own ledger" on public.ledgers;

create policy "read own ledger"   on public.ledgers for select using (auth.uid() = user_id);
create policy "insert own ledger" on public.ledgers for insert with check (auth.uid() = user_id);
create policy "update own ledger" on public.ledgers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own ledger" on public.ledgers for delete using (auth.uid() = user_id);

-- --- households -----------------------------------------------------------
drop policy if exists "read own households"     on public.households;
drop policy if exists "create households"       on public.households;
drop policy if exists "owner updates household" on public.households;
drop policy if exists "owner deletes household" on public.households;

create policy "read own households" on public.households for select
  using (created_by = auth.uid() or public.is_household_member(id));

create policy "create households" on public.households for insert
  with check (created_by = auth.uid());

create policy "owner updates household" on public.households for update
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy "owner deletes household" on public.households for delete
  using (created_by = auth.uid());

-- --- membership -----------------------------------------------------------
drop policy if exists "read membership"  on public.household_members;
drop policy if exists "owner invites"    on public.household_members;
drop policy if exists "claim own invite" on public.household_members;
drop policy if exists "owner revokes"    on public.household_members;

-- You can see members of a household you belong to, and you can see an
-- invitation addressed to you before you have joined anything.
create policy "read membership" on public.household_members for select
  using (
    user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or public.is_household_member(household_id)
  );

create policy "owner invites" on public.household_members for insert
  with check (
    exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
  );

-- Claiming an invitation: an unclaimed row addressed to your email becomes
-- yours. The WITH CHECK stops you attaching it to anybody else.
create policy "claim own invite" on public.household_members for update
  using (
    user_id = auth.uid()
    or (user_id is null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
  with check (user_id = auth.uid());

create policy "owner revokes" on public.household_members for delete
  using (
    exists (select 1 from public.households h where h.id = household_id and h.created_by = auth.uid())
  );

-- --- shared entries -------------------------------------------------------
drop policy if exists "read household entries" on public.shared_entries;
drop policy if exists "write own entries"      on public.shared_entries;
drop policy if exists "update own entries"     on public.shared_entries;
drop policy if exists "delete own entries"     on public.shared_entries;

-- Everyone in the household reads them; you only ever write your own.
create policy "read household entries" on public.shared_entries for select
  using (public.is_household_member(household_id));

create policy "write own entries" on public.shared_entries for insert
  with check (author_id = auth.uid() and public.is_household_member(household_id));

create policy "update own entries" on public.shared_entries for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy "delete own entries" on public.shared_entries for delete
  using (author_id = auth.uid());

-- ===========================================================================
-- 7. Realtime
-- ===========================================================================
--
-- Lets the other person's change arrive without polling. Realtime respects the
-- policies above, so nobody is sent a row they could not already read.

do $$
declare t text;
begin
  foreach t in array array['ledgers', 'shared_entries', 'household_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime not found; skipping realtime setup';
end
$$;

-- ===========================================================================
-- 8. Check it worked
-- ===========================================================================
--
-- Expect four rows, rls = true, and 4 policies on each.

select
  c.relname        as table_name,
  c.relrowsecurity as rls,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ledgers', 'households', 'household_members', 'shared_entries')
order by c.relname;
