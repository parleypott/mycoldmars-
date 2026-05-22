-- ============================================================
-- Queen Scarlet's School — persist character cards alongside stories
-- Idempotent. Safe to re-run.
-- ============================================================

-- Each entry: { name, synopsis, image: { mime, dataBase64 }, generated_at }
-- Stored inline on the story row so a single ?action=get hydrates everything.
-- Bounded by # of characters per story (rarely > 10), so row size stays
-- within Supabase's 8 MB row limit even with full base64 portraits.
alter table qss_stories
  add column if not exists character_cards jsonb default '[]'::jsonb;
