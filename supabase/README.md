# supabase/

Database migrations for the Newpress Interpreter. **Apply in order**, top to bottom. Every migration uses `IF NOT EXISTS` / `IF EXISTS` so re-running is safe.

## Apply on a fresh project

Open the Supabase SQL editor and paste each file's contents one at a time, in numeric order. Or via `psql`:

```bash
for f in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -f "$f"
done
```

## Migrations

| File | What it adds |
|---|---|
| `000_legacy_initial_schema.sql` | Original `transcripts`/`projects`/`tags`/`highlights` schema. Pre-Phase-1. **Skip on new installs** — superseded by `001`. Kept only for reference / pre-migration audits. |
| `001_phase1_core.sql` | Idempotent rebuild of the core schema: `projects`, `transcripts`, `tags`, `transcript_tags`, `highlights`, `ai_threads`. RLS enabled with permissive anon policies (single-user posture — see SECURITY.md). Indexes on `transcripts(project_id, updated_at, deleted_at)`. |
| `002_soft_delete.sql` | Adds `transcripts.deleted_at` for the Recently-Deleted / Trash sidebar view. Restored rows just clear the timestamp. |
| `003_add_missing_columns.sql` | Backfill columns added between phases (slug, custom_sequence_name, etc.). Idempotent ALTER TABLE ADD COLUMN IF NOT EXISTS. |
| `004_phase2_revisions_locks.sql` | `transcript_revisions` (auto-trimmed to 50 per transcript via trigger) + `editor_locks` (cross-tab edit lock with `last_seen` heartbeat). |
| `005_phase3_media_uploads.sql` | `media_uploads` table for video/audio source files, `media` Storage bucket (5 GB), columns for transcription status + waveform peaks. |
| `006_transcode_pipeline.sql` | `media_uploads.transcode_status` / `transcode_path` / `transcode_started_at` / `transcode_completed_at` / `transcode_error` for the worker that ffmpeg-converts ProRes to H.264. Index on pending status. |
| `007_presence_attribution.sql` | `transcript_revisions.client_label` + `client_color` so the History modal attributes edits to a self-attested user name (foundation for real auth later — see SECURITY.md "What I'd change to go multi-tenant"). |
| `008_lock_cleanup.sql` | `prune_stale_locks()` function + (if pg_cron available) a 15-min schedule that drops `editor_locks` rows older than 1 hour. |
| `009_media_orphan_cleanup.sql` | `prune_orphaned_media_uploads()` function + (if pg_cron available) a daily schedule. Drops `media_uploads` rows older than 24h that no transcript references — recovers from tab-close mid-upload. Storage objects are not auto-removed; sweep separately. |

## Why these are loose `.sql` files instead of a Supabase CLI migration set

The CLI tooling adds ceremony and a lock file we don't need at single-developer scale. The `IF NOT EXISTS` discipline plus this README is enough for now. If/when we go multi-developer or multi-environment, switch to `supabase migration new` + the linked CLI workflow.

## Rolling forward only

There are no `down()` migrations — schema goes one direction. If a column needs to be removed, write a new numbered migration (`008_drop_foo.sql`) rather than mutating an existing file. This keeps the history reproducible from any starting state.

## RLS posture

**All policies are permissive (`using (true) with check (true)` for the anon role).** This is intentional — see `../SECURITY.md` for the threat model and the path to multi-tenant tightening.
