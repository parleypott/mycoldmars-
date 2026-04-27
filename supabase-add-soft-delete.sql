-- Add soft-delete column to transcripts table
-- Paste this into Supabase SQL Editor and run.
alter table transcripts add column if not exists deleted_at timestamptz default null;
create index if not exists idx_transcripts_deleted on transcripts(deleted_at) where deleted_at is not null;
