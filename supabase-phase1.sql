-- ============================================================
-- Newpress Interpreter — Phase 1 Schema (idempotent)
-- Run this entire file once in the Supabase SQL Editor.
-- It supersedes:
--   supabase-schema.sql
--   supabase-add-missing-columns.sql
--   supabase-add-soft-delete.sql
-- and adds: transcript_aliases for UUID-canonical permalinks.
-- Safe to re-run. Uses IF NOT EXISTS / DROP IF EXISTS where needed.
-- ============================================================

-- 1. Projects ----------------------------------------------------
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- 2. Transcripts -------------------------------------------------
create table if not exists transcripts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  step                  int not null default 1,
  segments              jsonb default '[]'::jsonb,
  analysis              jsonb,
  translations          jsonb,
  srt_content           text,
  speaker_colors        jsonb default '{}'::jsonb,
  annotations           jsonb default '{}'::jsonb,
  metadata              jsonb default '{}'::jsonb,
  project_id            uuid references projects(id) on delete set null,
  speaker_map           jsonb default '{}'::jsonb,
  hidden_speakers       jsonb default '[]'::jsonb,
  editor_state          jsonb,
  custom_sequence_name  text default '',
  hide_unintelligible   boolean default true,
  word_timings          jsonb,
  slug                  text,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Add columns to existing tables if missing (for upgrades from earlier schema).
alter table transcripts add column if not exists slug text;
alter table transcripts add column if not exists deleted_at timestamptz;
alter table transcripts add column if not exists custom_sequence_name text default '';
alter table transcripts add column if not exists hide_unintelligible boolean default true;
alter table transcripts add column if not exists word_timings jsonb;
alter table transcripts add column if not exists editor_state jsonb;
alter table transcripts add column if not exists speaker_map jsonb default '{}'::jsonb;
alter table transcripts add column if not exists hidden_speakers jsonb default '[]'::jsonb;

create index if not exists idx_transcripts_project on transcripts(project_id);
create index if not exists idx_transcripts_updated on transcripts(updated_at desc);
create index if not exists idx_transcripts_deleted on transcripts(deleted_at);

-- The slug column on transcripts is a denormalized "current alias" for
-- convenience (so we can skip an alias lookup for the common case). The
-- alias table below is the source of truth and supports keeping old
-- links alive after rename. Keeping both lets us migrate gradually.
create unique index if not exists idx_transcripts_slug_unique
  on transcripts(slug)
  where slug is not null and deleted_at is null;

-- 3. Transcript Aliases (UUID-canonical permalinks) --------------
-- Every slug that has ever pointed at a transcript gets a row here.
-- Rename a transcript → add a new alias; the old slug keeps working.
-- The transcripts.slug column is the *current* alias for that row.
create table if not exists transcript_aliases (
  slug            text primary key,
  transcript_id   uuid not null references transcripts(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index if not exists idx_transcript_aliases_transcript
  on transcript_aliases(transcript_id);

-- Backfill: any existing transcript with a slug gets an alias row.
insert into transcript_aliases (slug, transcript_id, created_at)
select slug, id, coalesce(created_at, now())
from transcripts
where slug is not null
on conflict (slug) do nothing;

-- 4. Tags --------------------------------------------------------
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  name        text not null,
  color       text default '#DD2C1E',
  created_at  timestamptz not null default now()
);
create index if not exists idx_tags_project on tags(project_id);

-- 5. Highlights --------------------------------------------------
create table if not exists highlights (
  id                    uuid primary key default gen_random_uuid(),
  transcript_id         uuid references transcripts(id) on delete cascade,
  tag_id                uuid references tags(id) on delete set null,
  segment_numbers       jsonb default '[]'::jsonb,
  text_preview          text default '',
  original_text_preview text default '',
  note                  text,
  created_at            timestamptz not null default now()
);
create index if not exists idx_highlights_transcript on highlights(transcript_id);
create index if not exists idx_highlights_tag on highlights(tag_id);

-- 6. AI Threads --------------------------------------------------
create table if not exists ai_threads (
  id                    uuid primary key default gen_random_uuid(),
  transcript_id         uuid references transcripts(id) on delete cascade,
  anchor_text           text,
  anchor_original_text  text,
  messages              jsonb default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_ai_threads_transcript on ai_threads(transcript_id);

-- ============================================================
-- Row Level Security — anon-key public read/write (no auth).
-- ============================================================
alter table projects enable row level security;
alter table transcripts enable row level security;
alter table transcript_aliases enable row level security;
alter table tags enable row level security;
alter table highlights enable row level security;
alter table ai_threads enable row level security;

-- Drop & recreate so re-running is safe.
do $$
declare t text;
begin
  foreach t in array array['projects','transcripts','transcript_aliases','tags','highlights','ai_threads'] loop
    execute format('drop policy if exists "%s_select" on %s', t, t);
    execute format('drop policy if exists "%s_insert" on %s', t, t);
    execute format('drop policy if exists "%s_update" on %s', t, t);
    execute format('drop policy if exists "%s_delete" on %s', t, t);
  end loop;
end $$;

create policy "projects_select"            on projects            for select using (true);
create policy "projects_insert"            on projects            for insert with check (true);
create policy "projects_update"            on projects            for update using (true);
create policy "projects_delete"            on projects            for delete using (true);

create policy "transcripts_select"         on transcripts         for select using (true);
create policy "transcripts_insert"         on transcripts         for insert with check (true);
create policy "transcripts_update"         on transcripts         for update using (true);
create policy "transcripts_delete"         on transcripts         for delete using (true);

create policy "transcript_aliases_select"  on transcript_aliases  for select using (true);
create policy "transcript_aliases_insert"  on transcript_aliases  for insert with check (true);
create policy "transcript_aliases_update"  on transcript_aliases  for update using (true);
create policy "transcript_aliases_delete"  on transcript_aliases  for delete using (true);

create policy "tags_select"                on tags                for select using (true);
create policy "tags_insert"                on tags                for insert with check (true);
create policy "tags_update"                on tags                for update using (true);
create policy "tags_delete"                on tags                for delete using (true);

create policy "highlights_select"          on highlights          for select using (true);
create policy "highlights_insert"          on highlights          for insert with check (true);
create policy "highlights_update"          on highlights          for update using (true);
create policy "highlights_delete"          on highlights          for delete using (true);

create policy "ai_threads_select"          on ai_threads          for select using (true);
create policy "ai_threads_insert"          on ai_threads          for insert with check (true);
create policy "ai_threads_update"          on ai_threads          for update using (true);
create policy "ai_threads_delete"          on ai_threads          for delete using (true);
