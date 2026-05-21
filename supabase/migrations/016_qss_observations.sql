-- ============================================================
-- Queen Scarlet's School — behavioral observations
-- One row per meaningful event Henry triggers. Server enriches
-- payload with derived signals (character mentions, action-verb
-- category, sentence count, escalation lexicon score, etc.) at
-- write time so reports can be cheap reads later.
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists qss_observations (
  id          uuid primary key default gen_random_uuid(),
  story_id    uuid references qss_stories(id) on delete cascade,
  story_name  text,
  event       text not null,
  payload     jsonb default '{}'::jsonb,
  signals     jsonb default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_qss_obs_story_time on qss_observations(story_id, created_at desc);
create index if not exists idx_qss_obs_event on qss_observations(event);
create index if not exists idx_qss_obs_created on qss_observations(created_at desc);

-- GIN on signals so we can query "show me all blocks that contained Kevin"
create index if not exists idx_qss_obs_signals_gin on qss_observations using gin (signals);
