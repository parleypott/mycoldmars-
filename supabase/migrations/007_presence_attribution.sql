-- Add user-display label to revision rows so the History modal can show
-- "Brad edited this 2h ago" instead of just "this tab" / opaque client_id.
--
-- We don't have real auth (yet) — this is a self-attested name persisted
-- per browser in localStorage and written through to every revision +
-- lock + presence broadcast. Cheap accountability.

ALTER TABLE transcript_revisions ADD COLUMN IF NOT EXISTS client_label text;
ALTER TABLE transcript_revisions ADD COLUMN IF NOT EXISTS client_color text;

-- Older rows have NULL — that's fine, they'll display as "anonymous"
-- in the History modal. Going forward every new revision is attributed.

-- Note: editor_locks already has a holder_label column (used by the
-- "open in another tab" prompt). The client now writes the user name
-- into that column too, so the prompt reads naturally — "Open in
-- another tab" → "This transcript is being edited by Brad
-- (Chrome on Mac), last active 2 minutes ago."
