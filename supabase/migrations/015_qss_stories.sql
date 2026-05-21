-- ============================================================
-- Queen Scarlet's School — story library
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists qss_stories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  bible         text default '',
  rules         jsonb default '{}'::jsonb,
  blocks        jsonb default '[]'::jsonb,
  chat          jsonb default '[]'::jsonb,
  suggestions   jsonb default '[]'::jsonb,
  cover_image   text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- safety adds for upgrades
alter table qss_stories add column if not exists bible text default '';
alter table qss_stories add column if not exists rules jsonb default '{}'::jsonb;
alter table qss_stories add column if not exists blocks jsonb default '[]'::jsonb;
alter table qss_stories add column if not exists chat jsonb default '[]'::jsonb;
alter table qss_stories add column if not exists suggestions jsonb default '[]'::jsonb;
alter table qss_stories add column if not exists cover_image text;
alter table qss_stories add column if not exists deleted_at timestamptz;

-- One active story per name. Case-insensitive. Soft-deleted rows excluded.
drop index if exists idx_qss_stories_name_unique;
create unique index idx_qss_stories_name_unique
  on qss_stories (lower(name))
  where deleted_at is null;

create index if not exists idx_qss_stories_updated on qss_stories(updated_at desc);
create index if not exists idx_qss_stories_deleted on qss_stories(deleted_at);
create index if not exists idx_qss_stories_blocks_gin on qss_stories using gin (blocks);

-- Auto-bump updated_at on any change. Optimistic concurrency relies on
-- this column being authoritative and monotonic.
create or replace function qss_stories_touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_qss_stories_touch on qss_stories;
create trigger trg_qss_stories_touch
  before update on qss_stories
  for each row execute procedure qss_stories_touch_updated_at();
