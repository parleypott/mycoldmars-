-- Burma Script Tool — schema. Namespaced burma_* to coexist with the project's other tables.
-- Two tables = the data-loss design: the live doc + an append-only version history.

create table if not exists public.burma_scripts (
  id          text primary key,
  title       text not null default 'Burma — The Human Element',
  doc         jsonb not null,                 -- the full ScriptDoc (blocks, spans, timecodes)
  version     int  not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.burma_script_versions (
  id          bigint generated always as identity primary key,
  script_id   text not null references public.burma_scripts(id) on delete cascade,
  doc         jsonb not null,                 -- full snapshot at each save = time travel
  version     int  not null,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists idx_burma_versions on public.burma_script_versions(script_id, created_at desc);

-- No-auth phase: RLS on, permissive policies (anon can read/write). Tighten when we add logins.
alter table public.burma_scripts          enable row level security;
alter table public.burma_script_versions  enable row level security;
create policy "burma_scripts anon all"  on public.burma_scripts          for all using (true) with check (true);
create policy "burma_versions anon all" on public.burma_script_versions  for all using (true) with check (true);
