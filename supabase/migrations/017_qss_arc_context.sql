-- ============================================================
-- Queen Scarlet's School — arc context cache
-- One jsonb column on qss_stories holding the running narrative
-- understanding (synopsis, characters, threads, themes, next-moves).
-- Refreshed by /api/qss-arc-extract via Claude Haiku 4.5 after every
-- block_added (debounced 5s on the client).
-- Idempotent. Safe to re-run.
-- ============================================================

alter table qss_stories
  add column if not exists arc_context jsonb default '{}'::jsonb;

-- GIN index so we can later query "find stories with character X" cheaply.
create index if not exists idx_qss_stories_arc_gin
  on qss_stories using gin (arc_context);
