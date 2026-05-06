-- Hunter Phase 1 — Supabase migration
-- Run this against the same Supabase project as the Interpreter.
-- Tables are prefixed or namespaced to avoid collision.
-- media_assets is shared between Hunter and (future) Interpreter video features.

-- Projects (Hunter-specific — separate from Interpreter's projects table)
create table if not exists hunter_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Media assets (shared between Hunter and Interpreter)
create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references hunter_projects(id) on delete cascade,
  tier text not null check (tier in ('raw', 'script', 'selects', 'finished', 'google_docs')),
  source_kind text not null check (source_kind in ('dropbox', 'youtube', 'local', 'google_docs')),
  source_ref text not null,
  cache_path text,
  duration_seconds integer,
  format text default 'mp4',
  metadata jsonb default '{}',
  queue_status text default 'pending' check (queue_status in ('pending', 'fetching', 'cached', 'analyzing', 'done', 'error')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Corpus units — atomic analyzable chunks
create table if not exists corpus_units (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  start_seconds numeric,
  end_seconds numeric,
  source_clip_name text,
  track_label text,
  created_at timestamptz default now()
);

-- Analyses — per-unit Gemini analysis output
create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  corpus_unit_id uuid not null references corpus_units(id) on delete cascade,
  model text not null,
  prompt_version text,
  output_text text not null,
  output_json jsonb,
  cost_usd numeric default 0,
  created_at timestamptz default now()
);

-- Embeddings — vector representations of corpus units
-- Requires pgvector extension
create extension if not exists vector;

create table if not exists embeddings (
  id uuid primary key default gen_random_uuid(),
  corpus_unit_id uuid not null references corpus_units(id) on delete cascade,
  model text not null,
  embedding vector(768),
  created_at timestamptz default now()
);

-- Subjects — "Johnny" is the first one
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  reference_stills text[] default '{}',
  voice_sample_path text,
  description text default '',
  created_at timestamptz default now()
);

-- Subject appearances — tags linking subjects to corpus units
create table if not exists subject_appearances (
  subject_id uuid not null references subjects(id) on delete cascade,
  corpus_unit_id uuid not null references corpus_units(id) on delete cascade,
  confidence numeric default 0,
  notes text,
  primary key (subject_id, corpus_unit_id)
);

-- Pattern observations — the "what do you see?" output
create table if not exists pattern_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references hunter_projects(id) on delete set null,
  observation_text text not null,
  example_unit_ids uuid[] default '{}',
  status text default 'surfaced' check (status in ('surfaced', 'accepted', 'ignored', 'refined')),
  user_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index if not exists idx_media_assets_project on media_assets(project_id);
create index if not exists idx_media_assets_queue on media_assets(queue_status) where queue_status != 'done';
create index if not exists idx_corpus_units_asset on corpus_units(media_asset_id);
create index if not exists idx_analyses_unit on analyses(corpus_unit_id);
create index if not exists idx_embeddings_unit on embeddings(corpus_unit_id);
create index if not exists idx_pattern_obs_project on pattern_observations(project_id);

-- RLS: allow anon access (same pattern as Interpreter)
alter table hunter_projects enable row level security;
alter table media_assets enable row level security;
alter table corpus_units enable row level security;
alter table analyses enable row level security;
alter table embeddings enable row level security;
alter table subjects enable row level security;
alter table subject_appearances enable row level security;
alter table pattern_observations enable row level security;

create policy "anon_all" on hunter_projects for all using (true) with check (true);
create policy "anon_all" on media_assets for all using (true) with check (true);
create policy "anon_all" on corpus_units for all using (true) with check (true);
create policy "anon_all" on analyses for all using (true) with check (true);
create policy "anon_all" on embeddings for all using (true) with check (true);
create policy "anon_all" on subjects for all using (true) with check (true);
create policy "anon_all" on subject_appearances for all using (true) with check (true);
create policy "anon_all" on pattern_observations for all using (true) with check (true);
