-- ============================================================
-- Queen Scarlet's School — Freestyle tab persistence
-- Idempotent. Safe to re-run.
-- ============================================================

-- Freestyle is a separate, low-stakes brainstorm chat with Wordy that
-- runs alongside the main "Write with Wordy" flow. Its messages do NOT
-- bleed into the story canon (blocks / bible / arc); they live here so
-- Henry can riff and the system can capture soft themes that he may
-- later choose to promote into the actual story.

alter table qss_stories
  add column if not exists freestyle_chat   jsonb default '[]'::jsonb,
  add column if not exists freestyle_themes jsonb default '[]'::jsonb;
