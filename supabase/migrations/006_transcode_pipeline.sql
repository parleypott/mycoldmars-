-- Add transcoding pipeline columns to media_uploads.
--
-- Status values:
--   not_needed   — already a web-friendly codec (mp4/h264, mp3, m4a)
--   pending      — uploaded, waiting for the worker to pick it up
--   processing   — worker has the file in flight
--   done         — transcoded; transcode_path is populated and signable
--   error        — see transcode_error for the message
--
-- The worker polls for status='pending', flips to 'processing' atomically,
-- runs ffmpeg, uploads the H.264 result back into the same `media` bucket
-- under transcodes/<original-stamp>-<safe-name>.mp4, then flips to 'done'.

ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS transcode_status text NOT NULL DEFAULT 'not_needed';
ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS transcode_path text;
ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS transcode_error text;
ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS transcode_started_at timestamptz;
ALTER TABLE media_uploads ADD COLUMN IF NOT EXISTS transcode_completed_at timestamptz;

-- Worker lookup index: only the rows it cares about.
CREATE INDEX IF NOT EXISTS idx_media_uploads_transcode_pending
  ON media_uploads (created_at)
  WHERE transcode_status = 'pending';

-- Allow anon role to read the new columns (existing RLS policies cover row-level access).
-- Nothing to change here — column-level grants follow the table grant.
