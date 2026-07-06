-- 031_structure_boards.sql
-- Team cloud sync for /structure (STRUCTURE — a newpress tool).
--
-- One row per board slug (/structure/<slug>). The client loads the cloud
-- state on boot (falling back to localStorage, then the embedded seed),
-- pushes the full state blob with a 1.5s debounce after edits, and polls
-- for newer remote state every 10s when idle. Last-write-wins; the DB
-- trigger below bumps updated_at on every UPDATE so pollers can detect
-- fresh writes.
--
-- Safe to re-run. RLS enabled with permissive anon policies matching the
-- existing repo convention (see 022_winchester_state.sql).

create table if not exists public.structure_boards (
  slug        text primary key,
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.structure_boards enable row level security;

drop policy if exists "structure_boards read"   on public.structure_boards;
drop policy if exists "structure_boards write"  on public.structure_boards;
drop policy if exists "structure_boards update" on public.structure_boards;

create policy "structure_boards read"
  on public.structure_boards for select
  to anon, authenticated using (true);

create policy "structure_boards write"
  on public.structure_boards for insert
  to anon, authenticated with check (true);

create policy "structure_boards update"
  on public.structure_boards for update
  to anon, authenticated using (true) with check (true);

-- Trigger to bump updated_at on every UPDATE
create or replace function public.bump_structure_boards_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_structure_boards_updated_at on public.structure_boards;
create trigger trg_structure_boards_updated_at
  before update on public.structure_boards
  for each row execute function public.bump_structure_boards_updated_at();
