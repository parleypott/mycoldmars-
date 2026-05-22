-- ============================================================
-- 019 — Lock down wide-open RLS to authenticated role only
-- ============================================================
--
-- ENTERPRISE-LEVEL P0 SECURITY FIX. Migrations 001, 004, 005 created
-- every table policy as `using (true) with check (true)` — meaning
-- ANYONE with the public anon key (which ships in the browser bundle
-- and is trivially extractable) could:
--
--   * SELECT every transcript in the workspace (interview content,
--     speaker names, source media references, translations)
--   * INSERT arbitrary rows
--   * UPDATE any field on any row
--   * DELETE every row
--
-- via direct REST against the Supabase REST endpoint, completely
-- bypassing the app. Verified live: anonymous curl with just the
-- anon key returned real transcript bodies, accepted POSTs, and
-- accepted DELETEs.
--
-- This migration replaces every wide-open policy with one that
-- requires `auth.uid() is not null` — i.e., the caller must be a
-- signed-in Supabase auth user. Idempotent: each policy is dropped
-- if it exists, then re-created.
--
-- Trade-off: any code path that hit these tables via the anon key
-- without a session will now 401/403. The Interpreter signs every
-- user in before reaching the editor, so all real callers carry a
-- JWT and continue to work. Server-side service-role callers (API
-- routes) bypass RLS entirely and are unaffected.
-- ============================================================

do $$
declare
  t text;
  op text;
  pname text;
  tables text[] := array[
    'projects', 'transcripts', 'transcript_aliases', 'tags', 'highlights',
    'ai_threads', 'transcript_revisions', 'editor_locks'
  ];
  ops text[] := array['select', 'insert', 'update', 'delete'];
begin
  foreach t in array tables loop
    foreach op in array ops loop
      pname := format('%s_%s', t, op);
      execute format('drop policy if exists %I on %I', pname, t);
    end loop;
  end loop;
end $$;

-- Recreate as authenticated-only. `auth.uid() is not null` is the
-- canonical Supabase pattern for "must be signed in." Tighter
-- per-row ownership policies can come later — this just closes
-- the public-internet exposure first.
create policy "projects_select" on projects for select to authenticated using (auth.uid() is not null);
create policy "projects_insert" on projects for insert to authenticated with check (auth.uid() is not null);
create policy "projects_update" on projects for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "projects_delete" on projects for delete to authenticated using (auth.uid() is not null);

create policy "transcripts_select" on transcripts for select to authenticated using (auth.uid() is not null);
create policy "transcripts_insert" on transcripts for insert to authenticated with check (auth.uid() is not null);
create policy "transcripts_update" on transcripts for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "transcripts_delete" on transcripts for delete to authenticated using (auth.uid() is not null);

create policy "transcript_aliases_select" on transcript_aliases for select to authenticated using (auth.uid() is not null);
create policy "transcript_aliases_insert" on transcript_aliases for insert to authenticated with check (auth.uid() is not null);
create policy "transcript_aliases_update" on transcript_aliases for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "transcript_aliases_delete" on transcript_aliases for delete to authenticated using (auth.uid() is not null);

create policy "tags_select" on tags for select to authenticated using (auth.uid() is not null);
create policy "tags_insert" on tags for insert to authenticated with check (auth.uid() is not null);
create policy "tags_update" on tags for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "tags_delete" on tags for delete to authenticated using (auth.uid() is not null);

create policy "highlights_select" on highlights for select to authenticated using (auth.uid() is not null);
create policy "highlights_insert" on highlights for insert to authenticated with check (auth.uid() is not null);
create policy "highlights_update" on highlights for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "highlights_delete" on highlights for delete to authenticated using (auth.uid() is not null);

create policy "ai_threads_select" on ai_threads for select to authenticated using (auth.uid() is not null);
create policy "ai_threads_insert" on ai_threads for insert to authenticated with check (auth.uid() is not null);
create policy "ai_threads_update" on ai_threads for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "ai_threads_delete" on ai_threads for delete to authenticated using (auth.uid() is not null);

create policy "transcript_revisions_select" on transcript_revisions for select to authenticated using (auth.uid() is not null);
create policy "transcript_revisions_insert" on transcript_revisions for insert to authenticated with check (auth.uid() is not null);
create policy "transcript_revisions_update" on transcript_revisions for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "transcript_revisions_delete" on transcript_revisions for delete to authenticated using (auth.uid() is not null);

create policy "editor_locks_select" on editor_locks for select to authenticated using (auth.uid() is not null);
create policy "editor_locks_insert" on editor_locks for insert to authenticated with check (auth.uid() is not null);
create policy "editor_locks_update" on editor_locks for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "editor_locks_delete" on editor_locks for delete to authenticated using (auth.uid() is not null);

-- media_uploads got its own wide-open policy in 005; lock it down.
do $$ begin
  if exists (select 1 from pg_policies where schemaname='public' and tablename='media_uploads' and policyname='media_uploads_all') then
    drop policy "media_uploads_all" on media_uploads;
  end if;
end $$;
create policy "media_uploads_all" on media_uploads
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- ============================================================
-- Verify:
--   select tablename, policyname, roles
--     from pg_policies
--    where schemaname='public'
--      and tablename in ('projects','transcripts','tags','highlights',
--                        'ai_threads','transcript_revisions','editor_locks',
--                        'media_uploads','transcript_aliases')
--    order by tablename, policyname;
-- Every roles column should read {authenticated}, never {public}.
-- ============================================================
