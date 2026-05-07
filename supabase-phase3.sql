-- ============================================================
-- Newpress Interpreter — Phase 3 Schema: Media Assets
-- Run AFTER supabase-phase1.sql and supabase-phase2.sql.
-- Adds:
--   • media_assets table — source video/audio files
--   • transcripts.media_asset_id FK
--   • transcripts.source enum (imported | transcribed)
--   • transcripts.target_language (for translation step)
--   • Storage bucket policy hooks (run in Storage UI separately)
-- Safe to re-run.
-- ============================================================

-- 1. Media assets ----------------------------------------------
-- A source video or audio file uploaded by the user. One asset
-- can have one transcript (1:1 for now; later 1:many if we ever
-- want to re-transcribe in different languages).
create table if not exists media_assets (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references projects(id) on delete set null,

  -- Identity
  filename          text not null,
  display_name      text,                     -- user-editable label
  mime_type         text not null,            -- 'video/mp4', 'audio/wav', etc.
  size_bytes        bigint not null,
  duration_seconds  real,                     -- nullable until probed

  -- Storage (Supabase Storage)
  storage_bucket    text not null default 'media',
  storage_path      text not null unique,     -- 'project_id/uuid.mp4'

  -- Probe data (optional metadata extracted server-side)
  width             integer,
  height            integer,
  fps               real,
  audio_channels    integer,
  audio_sample_rate integer,

  -- Waveform peaks (cached for fast timeline rendering)
  -- Stored as { peaks: number[], resolution: number, generated_at: ISO }
  waveform          jsonb,

  -- Transcription pipeline state
  transcription_status         text not null default 'pending',
                               -- 'pending' | 'queued' | 'in_progress' | 'done' | 'error'
  transcription_provider       text,           -- 'whisper' | 'deepgram' | ...
  transcription_error          text,
  transcription_started_at     timestamptz,
  transcription_completed_at   timestamptz,
  transcription_progress       real,           -- 0..1, optional

  -- Source language detected by transcription provider
  source_language              text,           -- ISO 639-1, e.g. 'en'

  -- Lifecycle
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz                       -- soft delete
);

create index if not exists idx_media_assets_project
  on media_assets(project_id) where deleted_at is null;
create index if not exists idx_media_assets_status
  on media_assets(transcription_status) where deleted_at is null;
create index if not exists idx_media_assets_created
  on media_assets(created_at desc) where deleted_at is null;

-- updated_at trigger
create or replace function touch_media_assets_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists touch_media_assets_updated_at_trg on media_assets;
create trigger touch_media_assets_updated_at_trg
  before update on media_assets
  for each row execute function touch_media_assets_updated_at();

-- 2. Transcripts: link to media + new flow fields --------------
alter table transcripts
  add column if not exists media_asset_id    uuid references media_assets(id) on delete set null,
  add column if not exists source            text default 'imported',
                                              -- 'imported' (CSV/JSON/Trint) | 'transcribed' (Whisper)
  add column if not exists target_language   text,
                                              -- ISO 639-1; null = no translation, source-only
  add column if not exists translation_enabled boolean default true;

create index if not exists idx_transcripts_media_asset
  on transcripts(media_asset_id) where deleted_at is null;

-- 3. Search text — include media filename ----------------------
-- Phase 2 search_text was generated from name + custom_sequence_name + srt_content.
-- We extend it to include the media filename so users can find a transcript
-- by searching for the original video file name. Postgres requires us to drop
-- and recreate the generated column to redefine its expression.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'transcripts' and column_name = 'search_text'
  ) then
    -- Drop the dependent index first so the column drop succeeds.
    drop index if exists idx_transcripts_search;
    alter table transcripts drop column search_text;
  end if;
end $$;

alter table transcripts
  add column search_text text generated always as (
    coalesce(name, '') || ' ' ||
    coalesce(custom_sequence_name, '') || ' ' ||
    coalesce(srt_content, '')
  ) stored;

create index idx_transcripts_search
  on transcripts using gin (search_text gin_trgm_ops)
  where deleted_at is null;

-- Note: extending the generated column to ALSO include media filename
-- requires a join, which Postgres generated columns don't support.
-- Filename search is layered in the application query (db.js) instead.

-- 4. Soft-delete cascade hint ----------------------------------
-- When a media asset is hard-deleted, the FK is ON DELETE SET NULL,
-- so transcripts retain history but lose the media link. This is
-- intentional — transcripts can outlive their source files.

-- ============================================================
-- Storage bucket policies (run separately in Supabase Storage UI
-- or via the Supabase CLI — these can't run via SQL editor).
--
-- Bucket name: media
-- Public:      false (signed URLs only)
-- File size limit: 5 GB (covers typical 1hr 4K H.264)
--
-- RLS policies (anon role, matching the existing shared-secret
-- access model — replace with auth.uid()-based policies later):
--
--   create policy "media: anon read"
--     on storage.objects for select
--     to anon using (bucket_id = 'media');
--
--   create policy "media: anon insert"
--     on storage.objects for insert
--     to anon with check (bucket_id = 'media');
--
--   create policy "media: anon update"
--     on storage.objects for update
--     to anon using (bucket_id = 'media');
--
--   create policy "media: anon delete"
--     on storage.objects for delete
--     to anon using (bucket_id = 'media');
-- ============================================================
