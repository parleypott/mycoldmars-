-- Operational hygiene for editor_locks: stale locks accumulate forever
-- otherwise. A user closes a tab, the heartbeat stops, and the row sits in
-- the DB indefinitely. checkLock() ignores anything older than 5 minutes
-- (see translation/src/db.js), so the data is harmless — but the table
-- grows unbounded.
--
-- This migration adds a server-side cleanup function that prunes any lock
-- whose last_seen is older than 1 hour, plus a pg_cron schedule (if the
-- extension is available). If pg_cron isn't enabled on your Supabase
-- project, the function still exists and can be called manually:
--
--   select prune_stale_locks();
--
-- Enabling pg_cron in Supabase: Database → Extensions → search 'pg_cron'.

create or replace function prune_stale_locks()
returns integer
language plpgsql
security definer
as $$
declare
  removed integer;
begin
  delete from editor_locks
   where last_seen < now() - interval '1 hour';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function prune_stale_locks() is
  'Deletes editor_locks rows whose last_seen is older than 1 hour. Idempotent.';

-- Schedule it every 15 minutes if pg_cron is available. Wrapped in DO so
-- the migration doesn't fail on installs without the extension.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Drop any prior schedule with the same name so re-running this
    -- migration doesn't stack jobs.
    perform cron.unschedule(jobid)
      from cron.job
     where jobname = 'mcm_prune_stale_locks';
    perform cron.schedule(
      'mcm_prune_stale_locks',
      '*/15 * * * *',
      'select prune_stale_locks();'
    );
  end if;
end $$;
