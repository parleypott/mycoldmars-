-- 037 — Offline Lock (exclusive checkout) for scripts-library projects.
-- Applied live via the Supabase MCP on 2026-08-17; committed here for the record.
--
-- A holder claims the lock (locked_by = their auth uid, lock_token = a random secret) so they can
-- edit offline on a plane while every OTHER signed-in user goes read-only. Enforcement lives in the
-- SERVER (api/script-doc.js PUT refuses a non-holder 423; api/script-lock.js owns acquire/heartbeat/
-- release) because the API uses the service-role key (RLS bypassed) and the shared-workspace RLS has
-- no per-user ownership. Additive + nullable: an unset lock = unlocked = today's behavior.
alter table public.script_projects
  add column if not exists locked_by       uuid,
  add column if not exists locked_by_label text,
  add column if not exists locked_by_color text,
  add column if not exists locked_at       timestamptz,
  add column if not exists lock_token       text;

comment on column public.script_projects.locked_by is
  'Exclusive Offline Lock holder (auth user id). NULL = unlocked. While set, only this user (or a caller carrying the matching lock_token) may PUT the doc; enforced server-side in api/script-doc.js.';
comment on column public.script_projects.lock_token is
  'Random secret minted at acquire time. The holder''s device carries it (X-Lock-Token) so its own edits/flush pass even before JWT attribution resolves. Cleared on release.';
