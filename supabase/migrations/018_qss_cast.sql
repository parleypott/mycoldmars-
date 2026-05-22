-- ============================================================
-- Queen Scarlet's School — GLOBAL character cast
-- Idempotent. Safe to re-run.
-- ============================================================

-- One row per character, KEYED BY LOWERCASED NAME so Kevin/kevin
-- collapse to a single canonical entry across every story.
--
-- Each row carries portrait history (JSONB array of base64-encoded
-- images), chat history, visual_notes, and the list of stories the
-- character has appeared in. Cross-device sync: Henry refines a
-- character on laptop, the iPad picks up the changes the next time
-- the cast page loads.

create table if not exists qss_cast (
  name_key            text primary key,                 -- lowercased canonical key
  name                text not null,                    -- display name
  synopsis            text default '',
  visual_notes        text default '',
  portraits           jsonb default '[]'::jsonb,        -- [{id, mime, dataBase64, generated_at, note, loved?}]
  primary_portrait_id text,
  chat                jsonb default '[]'::jsonb,        -- [{id, role, content, ts}]
  story_appearances   jsonb default '[]'::jsonb,        -- [{story_id, story_name, intro_block, current_state, last_seen_at}]
  generated_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_qss_cast_updated on qss_cast(updated_at desc);

-- Auto-bump updated_at on any change so the client can detect changes
-- via simple polling without needing every column.
create or replace function qss_cast_touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_qss_cast_touch on qss_cast;
create trigger trg_qss_cast_touch
  before update on qss_cast
  for each row execute function qss_cast_touch_updated_at();
