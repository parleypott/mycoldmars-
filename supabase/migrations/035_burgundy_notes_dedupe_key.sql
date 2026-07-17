-- Reader-note idempotency key (2026-07-16).
--
-- A reader-note POST carried no idempotency key, so any time the request
-- reached the DB but looked failed to the client (6s abort, a mobile radio
-- drop that rejects fetch after the request landed, an offline-queue reflush)
-- it got retried and inserted a byte-identical twin. 23 duplicate pairs had
-- accumulated on the live reader; a short-quote note then painted twice in the
-- authoring tool.
--
-- dedupe_key is a client-generated per-save key. The server returns the
-- existing row instead of inserting when it recurs (api/burgundy-notes.js),
-- and this PARTIAL unique index is the hard backstop. Nullable so legacy /
-- keyless clients keep inserting freely (the index only constrains non-null
-- keys, so many NULLs coexist).
--
-- Idempotent (IF NOT EXISTS) — a no-op against the live DB where it was first
-- applied via apply_migration; this file exists so a rebuild-from-repo has it.

alter table public.burgundy_notes add column if not exists dedupe_key text;

create unique index if not exists burgundy_notes_dedupe_key_uniq
  on public.burgundy_notes (dedupe_key)
  where dedupe_key is not null;
