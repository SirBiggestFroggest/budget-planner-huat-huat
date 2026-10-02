-- Huat Huat · just the join-code and member-cap part.
--
-- The full schema.sql already ran; this is only the piece added afterwards.
-- Paste the whole file into the Supabase SQL editor and press Run.
-- Safe to run more than once.

-- ===========================================================================
-- 9. Joining by code, and a cap on how many people can
-- ===========================================================================
--
-- An email invite needs you to know their address and them to find the mail.
-- A short code is easier: you read it out, they type it in.
--
-- The cap is a safety measure, so it is enforced *here* rather than in the
-- page. The publishable key is public by design — anything checked only in the
-- browser can be skipped by anyone holding it. A database trigger cannot be.

alter table public.households
  add column if not exists join_code   text,
  add column if not exists max_members integer not null default 2;

-- A code points at exactly one ledger.
create unique index if not exists households_join_code_idx
  on public.households (join_code)
  where join_code is not null;

-- Between 2 and 10. One would make a shared ledger pointless; the upper bound
-- is there so a typo cannot quietly turn it into a public book.
alter table public.households
  drop constraint if exists households_max_members_sane;
alter table public.households
  add constraint households_max_members_sane
  check (max_members between 2 and 10);

-- ---------------------------------------------------------------------------
-- The cap, enforced on the way in
-- ---------------------------------------------------------------------------

create or replace function public.enforce_member_cap()
returns trigger
language plpgsql
as $$
declare
  cap   integer;
  taken integer;
begin
  select max_members into cap from public.households where id = new.household_id;
  select count(*) into taken from public.household_members where household_id = new.household_id;

  if taken >= cap then
    raise exception 'This ledger already has its maximum of % people.', cap
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists household_members_cap on public.household_members;
create trigger household_members_cap
  before insert on public.household_members
  for each row execute function public.enforce_member_cap();

-- ---------------------------------------------------------------------------
-- Joining
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER, and deliberately the ONLY way in by code. There is no
-- select policy letting a stranger read households, because one would let
-- anybody walk the table and harvest every ledger's code. This function answers
-- a single question — "does this exact code match, and is there room?" — and
-- returns nothing else.

create or replace function public.join_household_with_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target households;
  taken  integer;
  who    text;
  claimed integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before joining a ledger.' using errcode = 'insufficient_privilege';
  end if;

  select * into target
    from households
   where join_code = upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));

  if not found then
    raise exception 'That code does not match any ledger.' using errcode = 'no_data_found';
  end if;

  -- Already in it: say yes rather than erroring, so a second attempt is safe.
  if exists (
    select 1 from household_members
     where household_id = target.id and user_id = auth.uid()
  ) then
    return target.id;
  end if;

  select count(*) into taken from household_members where household_id = target.id;
  if taken >= target.max_members then
    raise exception 'That ledger is full.' using errcode = 'check_violation';
  end if;

  who := coalesce(auth.jwt() ->> 'email', '');

  -- An invitation may already be waiting for this address; claim it rather
  -- than adding a second row for the same person.
  update household_members
     set user_id = auth.uid(), status = 'active'
   where household_id = target.id
     and user_id is null
     and lower(email) = lower(who);

  get diagnostics claimed = row_count;

  if claimed = 0 then
    insert into household_members (household_id, user_id, email, display_name, status)
    values (target.id, auth.uid(), who, split_part(coalesce(nullif(who, ''), 'someone'), '@', 1), 'active');
  end if;

  return target.id;
end;
$$;

revoke all on function public.join_household_with_code(text) from public;
grant execute on function public.join_household_with_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Check it worked
-- ---------------------------------------------------------------------------

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='households'
      and column_name in ('join_code','max_members'))                      as new_columns,
  (select count(*) from pg_trigger where tgname = 'household_members_cap')  as cap_trigger,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='join_household_with_code')      as join_function;
