-- Adds the two columns that exist in supabase-schema.sql / are referenced by
-- translation/src/db.js but were never applied to the live Supabase project:
--   • slug         — clean URL permalinks for transcripts
--   • deleted_at   — soft-delete + 30-day Recently Deleted recovery
--
-- Paste into Supabase SQL Editor → Run.
-- Idempotent: safe to run multiple times.

alter table transcripts add column if not exists slug text;
create unique index if not exists transcripts_slug_key on transcripts(slug) where slug is not null;
create index if not exists idx_transcripts_slug on transcripts(slug);

alter table transcripts add column if not exists deleted_at timestamptz default null;
create index if not exists idx_transcripts_deleted on transcripts(deleted_at) where deleted_at is not null;
