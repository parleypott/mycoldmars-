-- ============================================================
-- Newpress Interpreter — Phase 3 Schema: Media Uploads
-- Run AFTER supabase-phase1.sql and supabase-phase2.sql.
-- Idempotent and safe to re-run.
--
-- Adds the Interpreter's in-house transcription pipeline:
--   • media_uploads table — files uploaded directly to Supabase Storage
--     for in-app transcription (separate from Hunter's media_assets,
--     which catalogs external Dropbox/YouTube/local references and is
--     constrained to those source_kinds via a check constraint)
--   • transcripts.media_upload_id FK
--   • transcripts.source enum (imported | transcribed)
--   • transcripts.target_language + translation_enabled
--   • Storage bucket 'media' with anon RLS (matches the existing access model)
-- ============================================================

-- 1. media_uploads table -------------------------------------------------
-- A source video or audio file the user uploaded directly into the
-- Interpreter for in-house transcription. One upload : one transcript.
create table if not exists media_uploads (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references projects(id) on delete set null,

  -- Identity
  filename          text not null,
  display_name      text,
  mime_type         text not null,
  size_bytes        bigint not null,
  duration_seconds  real,

  -- Supabase Storage location
  storage_bucket    text not null default 'media',
  storage_path      text not null unique,    -- e.g. 'project_id/uuid.mp4'

  -- Probed metadata (optional, server-side ffprobe in v2)
  width             integer,
  height            integer,
  fps               real,
  audio_channels    integer,
  audio_sample_rate integer,

  -- Cached waveform peaks for fast timeline rendering
  -- shape: { peaks: number[], resolution: number, generated_at: ISO }
  waveform          jsonb,

  -- Transcription pipeline state
  transcription_status         text not null default 'pending',
                               -- 'pending' | 'queued' | 'in_progress' | 'done' | 'error'
  transcription_provider       text,           -- 'whisper' | 'deepgram' | ...
  transcription_error          text,
  transcription_started_at     timestamptz,
  transcription_completed_at   timestamptz,
  transcription_progress       real,           -- 0..1

  -- Source language detected by transcription provider
  source_language              text,           -- ISO 639-1

  -- Lifecycle
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  constraint media_uploads_status_check
    check (transcription_status in ('pending','queued','in_progress','done','error'))
);

create index if not exists idx_media_uploads_project
  on media_uploads(project_id) where deleted_at is null;
create index if not exists idx_media_uploads_status
  on media_uploads(transcription_status) where deleted_at is null;
create index if not exists idx_media_uploads_created
  on media_uploads(created_at desc) where deleted_at is null;

-- updated_at trigger
create or replace function touch_media_uploads_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists touch_media_uploads_updated_at_trg on media_uploads;
create trigger touch_media_uploads_updated_at_trg
  before update on media_uploads
  for each row execute function touch_media_uploads_updated_at();

-- RLS: match the existing access model (no auth, anon allowed via shared secret)
alter table media_uploads enable row level security;

drop policy if exists "media_uploads_anon_all" on media_uploads;
create policy "media_uploads_anon_all" on media_uploads
  for all to anon
  using (true) with check (true);

-- 2. transcripts: link + new flow fields ---------------------------------
alter table transcripts
  add column if not exists media_upload_id     uuid references media_uploads(id) on delete set null,
  add column if not exists source              text default 'imported',
                                                -- 'imported' (CSV/JSON/Trint) | 'transcribed' (Whisper)
  add column if not exists target_language     text,
                                                -- ISO 639-1; null = no translation
  add column if not exists translation_enabled boolean default true;

create index if not exists idx_transcripts_media_upload
  on transcripts(media_upload_id) where deleted_at is null;

-- 3. Storage bucket: 'media' --------------------------------------------
-- Create the bucket via SQL so the migration is fully self-contained.
-- 5 GB limit covers 1hr 4K H.264 at conservative bitrates.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', false,
  5368709120, -- 5 GB
  array['video/mp4','video/quicktime','video/webm','video/x-matroska','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm','audio/ogg','audio/flac']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 4. Storage RLS policies (anon role, matching shared-secret model) -----
-- Drop & recreate so this migration is idempotent.
do $$
begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_anon_select') then
    drop policy "media_anon_select" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_anon_insert') then
    drop policy "media_anon_insert" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_anon_update') then
    drop policy "media_anon_update" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_anon_delete') then
    drop policy "media_anon_delete" on storage.objects;
  end if;
end $$;

create policy "media_anon_select" on storage.objects
  for select to anon using (bucket_id = 'media');
create policy "media_anon_insert" on storage.objects
  for insert to anon with check (bucket_id = 'media');
create policy "media_anon_update" on storage.objects
  for update to anon using (bucket_id = 'media') with check (bucket_id = 'media');
create policy "media_anon_delete" on storage.objects
  for delete to anon using (bucket_id = 'media');

-- ============================================================
-- Done. Verify in psql:
--   \d public.media_uploads
--   select id, name, public, file_size_limit from storage.buckets;
--   select policyname from pg_policies where tablename='objects' and policyname like 'media_%';
-- ============================================================
