-- ============================================================
-- Newpress Interpreter — Phase 2 & 3 Schema (idempotent)
-- Run this AFTER supabase-phase1.sql.
-- Adds: revisions, editor_locks, full-text search, realtime.
-- Safe to re-run.
-- ============================================================

-- pg_trgm gives us fast substring/ILIKE search via GIN.
create extension if not exists pg_trgm;

-- 1. Transcript revisions ----------------------------------------
-- Every successful save inserts one row here. Cheap insurance for
-- "I want my old version back" — also enables an explicit version
-- history UI. We keep the last N per transcript via a trigger below.
create table if not exists transcript_revisions (
  id            uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references transcripts(id) on delete cascade,
  snapshot      jsonb not null,
  source        text default 'autosave',  -- 'autosave' | 'manual' | 'restore' | 'conflict-overwrite'
  client_id     text,                     -- which tab/browser made this revision
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_transcript_revisions_lookup
  on transcript_revisions(transcript_id, created_at desc);

-- Cap at 50 revisions per transcript so storage stays bounded.
create or replace function trim_transcript_revisions() returns trigger as $$
begin
  delete from transcript_revisions
  where transcript_id = new.transcript_id
    and id not in (
      select id from transcript_revisions
      where transcript_id = new.transcript_id
      order by created_at desc
      limit 50
    );
  return new;
end;
$$ language plpgsql;

drop trigger if exists trim_transcript_revisions_trg on transcript_revisions;
create trigger trim_transcript_revisions_trg
  after insert on transcript_revisions
  for each row execute function trim_transcript_revisions();

-- 2. Editor locks ------------------------------------------------
-- Soft "who's editing this transcript right now" advisory lock.
-- Not enforced by the DB (anyone can take over) — used by the UI
-- to warn before two tabs collide.
create table if not exists editor_locks (
  transcript_id  uuid primary key references transcripts(id) on delete cascade,
  holder_id      text not null,
  holder_label   text,                          -- "Chrome on Mac" etc.
  last_seen      timestamptz not null default now()
);
create index if not exists idx_editor_locks_last_seen on editor_locks(last_seen desc);

-- 3. Full-text search column -------------------------------------
-- Generated column denormalizes searchable text for fast substring
-- matching via pg_trgm. We index name, sequence name, and SRT (which
-- carries the entire translated transcript text).
alter table transcripts
  add column if not exists search_text text generated always as (
    coalesce(name, '') || ' ' ||
    coalesce(custom_sequence_name, '') || ' ' ||
    coalesce(srt_content, '')
  ) stored;

create index if not exists idx_transcripts_search
  on transcripts using gin (search_text gin_trgm_ops)
  where deleted_at is null;

-- 4. Realtime ----------------------------------------------------
-- Make transcripts changes available via Supabase Realtime so other
-- tabs can react to remote edits. The publication may already exist
-- with a different table set; we add transcripts only if missing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'transcripts'
  ) then
    execute 'alter publication supabase_realtime add table transcripts';
  end if;
end $$;

-- Realtime needs full row data on UPDATE/DELETE.
alter table transcripts replica identity full;

-- 5. RLS for new tables ------------------------------------------
alter table transcript_revisions enable row level security;
alter table editor_locks         enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['transcript_revisions','editor_locks']) loop
    execute format('drop policy if exists "%s_select" on %s', t, t);
    execute format('drop policy if exists "%s_insert" on %s', t, t);
    execute format('drop policy if exists "%s_update" on %s', t, t);
    execute format('drop policy if exists "%s_delete" on %s', t, t);
  end loop;
end $$;

create policy "transcript_revisions_select" on transcript_revisions for select using (true);
create policy "transcript_revisions_insert" on transcript_revisions for insert with check (true);
create policy "transcript_revisions_update" on transcript_revisions for update using (true);
create policy "transcript_revisions_delete" on transcript_revisions for delete using (true);

create policy "editor_locks_select" on editor_locks for select using (true);
create policy "editor_locks_insert" on editor_locks for insert with check (true);
create policy "editor_locks_update" on editor_locks for update using (true);
create policy "editor_locks_delete" on editor_locks for delete using (true);
