-- Huat Huat · Supabase schema
--
-- Run this once in your project's SQL editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It is safe to re-run: every statement is guarded.
--
-- The whole ledger is stored as a single JSON document per user. That suits
-- this app: the client already keeps the ledger as one state object, entries
-- are typed in by hand so the document stays small, and it means adding a
-- field to the app never needs a migration here.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.ledgers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb       not null,
  device     text,
  updated_at timestamptz not null default now()
);

comment on table public.ledgers is
  'One ledger document per signed-in user. Protected by row level security.';

-- ---------------------------------------------------------------------------
-- updated_at is the server's to set
-- ---------------------------------------------------------------------------
--
-- Two browsers resolving a conflict both need to trust the same clock. A client
-- supplied timestamp can be wrong (a laptop with a skewed clock) or dishonest,
-- so the database stamps every write itself.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ledgers_touch_updated_at on public.ledgers;
create trigger ledgers_touch_updated_at
  before insert or update on public.ledgers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- This is the part that actually protects the data. The anon key shipped in the
-- page is public by design; these policies are what stop one signed-in user
-- reading another's ledger. Without them the table would be world-readable to
-- anyone holding that key.

alter table public.ledgers enable row level security;

drop policy if exists "read own ledger"   on public.ledgers;
drop policy if exists "insert own ledger" on public.ledgers;
drop policy if exists "update own ledger" on public.ledgers;
drop policy if exists "delete own ledger" on public.ledgers;

create policy "read own ledger"
  on public.ledgers for select
  using (auth.uid() = user_id);

create policy "insert own ledger"
  on public.ledgers for insert
  with check (auth.uid() = user_id);

create policy "update own ledger"
  on public.ledgers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own ledger"
  on public.ledgers for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Lets a second tab or a second device pick up a change as it happens, instead
-- of polling. Realtime respects the policies above, so a user is only ever sent
-- their own rows.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ledgers'
  ) then
    alter publication supabase_realtime add table public.ledgers;
  end if;
exception
  when undefined_object then
    raise notice 'publication supabase_realtime not found; skipping realtime setup';
end
$$;

-- ---------------------------------------------------------------------------
-- Check it worked
-- ---------------------------------------------------------------------------
--
-- Expect: rls_enabled = true, and four policies.

select
  (select relrowsecurity from pg_class where oid = 'public.ledgers'::regclass) as rls_enabled,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'ledgers') as policy_count;
