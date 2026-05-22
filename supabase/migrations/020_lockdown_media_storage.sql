-- ============================================================
-- 020 — Lock down media_uploads + storage.objects anon access
-- ============================================================
--
-- P0 LIVE EXPLOIT. The adversarial audit verified:
--   - `media_uploads` table is still anon-readable / writable —
--     migration 019 tried to drop a policy named "media_uploads_all"
--     but the actual policy was created with a different name in 005
--     and never got dropped. Anonymous curl with just the anon key
--     can SELECT every row (storage paths, filenames, sizes) and
--     PATCH / DELETE freely.
--   - `storage.objects` still has migration 005's `media_anon_*`
--     policies — anonymous SELECT against the storage bucket returns
--     real .mp4 bytes. Full corpus exfiltration possible.
--
-- This migration replaces every anon policy on these surfaces with
-- authenticated-only equivalents. Server-side service-role callers
-- (Edge functions using SUPABASE_SERVICE_ROLE_KEY) bypass RLS so
-- transcribe + nano-banana + signed-URL minting keep working.
-- ============================================================

-- 1) Drop EVERY existing policy on public.media_uploads, regardless of
-- name. Then recreate as authenticated-only. We can't enumerate by
-- name because earlier migrations used different policy names across
-- versions; the do-block walks pg_policies.
do $$
declare r record;
begin
  for r in select policyname from pg_policies
           where schemaname = 'public' and tablename = 'media_uploads'
  loop
    execute format('drop policy if exists %I on public.media_uploads', r.policyname);
  end loop;
end $$;

alter table public.media_uploads enable row level security;

create policy "media_uploads_select_auth" on public.media_uploads
  for select to authenticated using (auth.uid() is not null);
create policy "media_uploads_insert_auth" on public.media_uploads
  for insert to authenticated with check (auth.uid() is not null);
create policy "media_uploads_update_auth" on public.media_uploads
  for update to authenticated
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "media_uploads_delete_auth" on public.media_uploads
  for delete to authenticated using (auth.uid() is not null);

-- 2) storage.objects: drop the anon policies from migration 005 and
-- keep only the authenticated set added in migration 018. Anonymous
-- callers can no longer read or write objects in the media bucket.
do $$ begin
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

-- The migration 018 authenticated policies (media_auth_select/insert/
-- update/delete) are already in place; not re-creating them here. If
-- they ever get dropped, migration 018 re-creates idempotently.

-- 3) qss tables — migrations 015/016/017 enabled RLS but added no
-- policies. Default deny works today, but if anyone ever runs
-- `alter table ... disable row level security` the floodgates open.
-- Add explicit authenticated-only policies as a tripwire.
do $$
declare t text;
begin
  for t in select unnest(array['qss_stories', 'qss_observations', 'qss_arc_context'])
  loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      execute format('alter table public.%I enable row level security', t);
      -- Drop any existing all-policy by predictable name
      execute format('drop policy if exists %I on public.%I', t || '_auth', t);
      execute format('create policy %I on public.%I for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)', t || '_auth', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- Verify:
--   select tablename, policyname, roles
--     from pg_policies
--    where schemaname in ('public', 'storage')
--      and (tablename = 'media_uploads' or tablename = 'objects'
--           or tablename like 'qss_%')
--    order by tablename, policyname;
--
--   Then probe live:
--   curl -s "https://ukqimqkifkhdavveopdm.supabase.co/rest/v1/media_uploads?select=*" \
--     -H "apikey: <anon-key>"
--   should return []
-- ============================================================
