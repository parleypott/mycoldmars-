-- 022_winchester_state.sql
-- Cross-machine state sync for /winchester (Westchester House Hunter).
--
-- The winchester page previously stored everything in localStorage:
--   whh:pins:v1, whh:villages:v1, whh:money:v1, whh:scenarios:v1,
--   whh:agent:memory:v1, whh:agent:chat:v1, etc.
--
-- On a fresh machine the user would see an empty page even though they
-- had pinned dozens of homes on their main machine. This table is the
-- cloud source of truth — a single-row blob keyed by id='singleton'
-- (since the app is gated to a single user via ACCESS_CODE).
--
-- The page reads this row on boot, hydrates localStorage, then pushes
-- back here with a debounce whenever local state changes. Optimistic
-- concurrency via updated_at avoids one tab clobbering another.
--
-- Safe to re-run. RLS enabled with permissive anon policies matching
-- the existing repo convention (see SECURITY.md).

create table if not exists public.winchester_state (
  id          text primary key,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Seed the singleton row so the GET endpoint never has to handle "no row yet"
insert into public.winchester_state (id, state)
values ('singleton', '{}'::jsonb)
on conflict (id) do nothing;

alter table public.winchester_state enable row level security;

drop policy if exists "winchester_state read"  on public.winchester_state;
drop policy if exists "winchester_state write" on public.winchester_state;
drop policy if exists "winchester_state update" on public.winchester_state;

create policy "winchester_state read"
  on public.winchester_state for select
  to anon, authenticated using (true);

create policy "winchester_state write"
  on public.winchester_state for insert
  to anon, authenticated with check (true);

create policy "winchester_state update"
  on public.winchester_state for update
  to anon, authenticated using (true) with check (true);

-- Trigger to bump updated_at on every UPDATE
create or replace function public.bump_winchester_state_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_winchester_state_updated_at on public.winchester_state;
create trigger trg_winchester_state_updated_at
  before update on public.winchester_state
  for each row execute function public.bump_winchester_state_updated_at();
