-- ============================================================
-- 018 — Storage RLS: cover authenticated role on the media bucket
-- ============================================================
--
-- Migration 005 set up storage.objects policies for the `anon` role
-- only (back when the app was anon + access-code gated). Migration 010
-- introduced auth/workspace — now real users sign in and become the
-- `authenticated` role. Postgres RLS roles are NOT inherited: a policy
-- "to anon" does not apply to authenticated users. Net effect: signing
-- in BREAKS uploads with "new row violates row-level security policy"
-- on POST /storage/v1/upload/resumable.
--
-- This migration adds matching policies for the authenticated role on
-- the media bucket, mirroring the anon set so behavior is consistent
-- whether the user is signed in or running access-code only.
-- ============================================================

-- Drop any prior versions so this migration is idempotent.
do $$ begin
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_auth_select') then
    drop policy "media_auth_select" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_auth_insert') then
    drop policy "media_auth_insert" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_auth_update') then
    drop policy "media_auth_update" on storage.objects;
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='media_auth_delete') then
    drop policy "media_auth_delete" on storage.objects;
  end if;
end $$;

create policy "media_auth_select" on storage.objects
  for select to authenticated using (bucket_id = 'media');
create policy "media_auth_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
create policy "media_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'media') with check (bucket_id = 'media');
create policy "media_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'media');

-- ============================================================
-- Verify:
--   select policyname, roles from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'media_%'
--    order by policyname;
-- ============================================================
