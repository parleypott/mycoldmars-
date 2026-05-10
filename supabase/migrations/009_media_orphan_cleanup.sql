-- Operational hygiene for media_uploads: a tab close mid-upload (or a
-- failed first-save) leaves a media_uploads row + a Storage object
-- without any transcript_id pointing at them. Over time this orphans
-- bytes in Storage and rows in the DB. The Library never surfaces them
-- so they're invisible — pure dead weight.
--
-- This migration adds prune_orphaned_media_uploads() — deletes rows
-- whose id isn't referenced by ANY transcript AND were created more
-- than 24 hours ago. The 24h grace lets in-progress uploads (long
-- ProRes files, slow networks) finish without being culled.
--
-- The cleanup function only deletes the DB row. To remove the underlying
-- Storage object too, an out-of-band sweep is required (Supabase Storage
-- doesn't cascade from row deletes). For solo-scale that's fine — the
-- overhead is bounded; document for the eventual multi-tenant migration.

create or replace function prune_orphaned_media_uploads()
returns integer
language plpgsql
security definer
as $$
declare
  removed integer;
begin
  delete from media_uploads m
   where m.created_at < now() - interval '24 hours'
     and not exists (
       select 1 from transcripts t where t.media_upload_id = m.id
     );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function prune_orphaned_media_uploads() is
  'Deletes media_uploads rows older than 24h with no referencing transcript. Idempotent. Storage objects are NOT removed; sweep separately.';

-- Schedule daily at 03:17 UTC if pg_cron is available.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'mcm_prune_orphaned_media';
    perform cron.schedule(
      'mcm_prune_orphaned_media',
      '17 3 * * *',
      'select prune_orphaned_media_uploads();'
    );
  end if;
end $$;
