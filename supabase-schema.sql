-- ============================================================
-- Newpress Interpreter — Supabase Schema
-- Paste this entire file into the Supabase SQL Editor and run.
-- ============================================================

-- 1. Projects
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- 2. Transcripts
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
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_transcripts_project on transcripts(project_id);
create index if not exists idx_transcripts_updated on transcripts(updated_at desc);

-- 3. Tags
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  name        text not null,
  color       text default '#DD2C1E',
  created_at  timestamptz not null default now()
);

create index if not exists idx_tags_project on tags(project_id);

-- 4. Highlights
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

-- 5. AI Threads
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
-- Row Level Security (RLS)
-- Enables public read access via anon key so shared links work.
-- All writes also allowed via anon key (no auth required).
-- ============================================================

alter table projects enable row level security;
alter table transcripts enable row level security;
alter table tags enable row level security;
alter table highlights enable row level security;
alter table ai_threads enable row level security;

-- Projects: full access
create policy "projects_select" on projects for select using (true);
create policy "projects_insert" on projects for insert with check (true);
create policy "projects_update" on projects for update using (true);
create policy "projects_delete" on projects for delete using (true);

-- Transcripts: full access
create policy "transcripts_select" on transcripts for select using (true);
create policy "transcripts_insert" on transcripts for insert with check (true);
create policy "transcripts_update" on transcripts for update using (true);
create policy "transcripts_delete" on transcripts for delete using (true);

-- Tags: full access
create policy "tags_select" on tags for select using (true);
create policy "tags_insert" on tags for insert with check (true);
create policy "tags_update" on tags for update using (true);
create policy "tags_delete" on tags for delete using (true);

-- Highlights: full access
create policy "highlights_select" on highlights for select using (true);
create policy "highlights_insert" on highlights for insert with check (true);
create policy "highlights_update" on highlights for update using (true);
create policy "highlights_delete" on highlights for delete using (true);

-- AI Threads: full access
create policy "ai_threads_select" on ai_threads for select using (true);
create policy "ai_threads_insert" on ai_threads for insert with check (true);
create policy "ai_threads_update" on ai_threads for update using (true);
create policy "ai_threads_delete" on ai_threads for delete using (true);
