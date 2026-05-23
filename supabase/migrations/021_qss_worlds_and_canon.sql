-- ============================================================
-- Queen Scarlet's School — multi-world architecture
-- Idempotent. Safe to re-run.
-- ============================================================
--
-- Henry's storytelling tool is no longer single-world. The first world
-- is "Queen Scarlet's Apocalypse School" (existing data). The second is
-- "Puppy Town — the Rico Uprising" (Act I just dropped, Act II is queued).
-- More worlds will follow.
--
-- This migration:
--   1. Adds `world_slug` to qss_stories and qss_cast so existing data
--      can be partitioned by world.
--   2. Creates `qss_worlds` — first-class world records carrying canon
--      text, art-style configuration, planet visuals (for the universe
--      landing page), and metadata.
--   3. Creates `qss_world_canon` — canonical lore documents per world.
--      Distinct from `qss_stories.bible` (which is Henry's free-form
--      rules) — these are AUTHORED reference documents like
--      `puppy_town_act1.md`. Acts get their own rows.
--   4. Creates `qss_world_characters` — canonical characters per world
--      that exist BEFORE Henry writes about them (Burgundy, the Puppy
--      King, Queen Scarlet). Different from `qss_cast` which is
--      portraits Henry has generated. A canonical character can have
--      multiple `qss_cast` rows tied to it as Henry refines portraits.
-- ============================================================

-- ─── 1. World partition columns ─────────────────────────────────────
alter table qss_stories add column if not exists world_slug text;
alter table qss_cast    add column if not exists world_slug text;

-- Backfill — every existing row belongs to queen-scarlet by definition.
update qss_stories set world_slug = 'queen-scarlet' where world_slug is null;
update qss_cast    set world_slug = 'queen-scarlet' where world_slug is null;

create index if not exists idx_qss_stories_world on qss_stories(world_slug);
create index if not exists idx_qss_cast_world    on qss_cast(world_slug);

-- The qss_cast PK is `name_key`; but name uniqueness is now PER WORLD,
-- not global. Burgundy-the-puppy-prince should not collide with a
-- Burgundy-the-bean-thief in QSS. Drop the global PK and replace with
-- a composite uniqueness constraint on (world_slug, name_key).
--
-- Defensive: only run if the existing PK is still `name_key`.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'qss_cast'
      and constraint_type = 'PRIMARY KEY'
      and constraint_name = 'qss_cast_pkey'
  ) then
    alter table qss_cast drop constraint qss_cast_pkey;
    -- Add a surrogate id column. Keeps existing rows working without
    -- requiring a NOT NULL migration on name_key.
    alter table qss_cast add column if not exists id uuid default gen_random_uuid();
    update qss_cast set id = gen_random_uuid() where id is null;
    alter table qss_cast alter column id set not null;
    alter table qss_cast add primary key (id);
    -- World-scoped uniqueness
    create unique index if not exists idx_qss_cast_world_name
      on qss_cast (world_slug, name_key);
  end if;
end$$;

-- ─── 2. qss_worlds (first-class world records) ──────────────────────
create table if not exists qss_worlds (
  slug              text primary key,
  name              text not null,
  short_name        text default '',
  tagline           text default '',
  mascot            text default '',          -- emoji or short string
  -- Visual identity for the cosmic universe landing page + per-world
  -- theme tokens. Mirrors public/queen-scarlet-school/lib/worlds.js
  -- shape so the client can hydrate from the DB instead of the
  -- hardcoded registry once we wire up server-driven worlds.
  colors            jsonb default '{}'::jsonb,  -- {accent, accentDeep, primary, primaryDeep}
  planet            jsonb default '{}'::jsonb,  -- {size, x, y, surface, glow, ring, atmosphere, bauble}
  art_style         jsonb default '{}'::jsonb,  -- {styleBlock, references, dontList, paper}
  canon_text        text default '',            -- World-level system-prompt overlay
  archived          boolean default false,
  display_order     int default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_qss_worlds_order on qss_worlds(display_order, slug);

-- Touch trigger
create or replace function qss_worlds_touch_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_qss_worlds_touch on qss_worlds;
create trigger trg_qss_worlds_touch
  before update on qss_worlds
  for each row execute function qss_worlds_touch_updated_at();

-- Seed the two existing worlds with minimal stubs — full data ships
-- via the client-side worlds.js registry for now. This row exists so
-- foreign-key style references from qss_world_canon and
-- qss_world_characters resolve cleanly.
insert into qss_worlds (slug, name, short_name, tagline, display_order)
values
  ('queen-scarlet', 'Queen Scarlet''s Apocalypse School', 'Queen Scarlet',
   'a magical school where everything is technically fine', 0),
  ('burgundy', 'Puppy Town — the Rico Uprising', 'Puppy Town',
   'King of the Puppies, God of Machines', 1)
on conflict (slug) do nothing;

-- ─── 3. qss_world_canon (acts / volumes / canonical documents) ──────
--
-- Authored lore documents, NOT Henry's writing. Each row is one
-- canonical reference — Act I, Act II, a character bible, a setting
-- document. Used to feed AI prompts and as authoritative truth.
-- Henry's stories may RIFF on these but cannot rewrite them from
-- inside the writing tool.
create table if not exists qss_world_canon (
  id              uuid primary key default gen_random_uuid(),
  world_slug      text not null references qss_worlds(slug) on delete cascade,
  -- A short identifier within a world: 'act-1', 'act-2', 'bible',
  -- 'setting', 'character-burgundy'. Unique per world.
  doc_key         text not null,
  title           text not null,
  -- 'act' | 'volume' | 'bible' | 'setting' | 'character' | 'glossary'
  doc_type        text not null default 'act',
  -- The body text. Plain markdown. AI gets this verbatim as overlay.
  body            text default '',
  -- Optional structured metadata — themes[], beats[], open_calls[],
  -- act_order, etc. Schema is intentionally loose for now.
  meta            jsonb default '{}'::jsonb,
  -- Sequencing within the world (acts in order).
  display_order   int default 0,
  archived        boolean default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists idx_qss_canon_world_key
  on qss_world_canon (world_slug, doc_key);
create index if not exists idx_qss_canon_world_order
  on qss_world_canon (world_slug, display_order);

create or replace function qss_world_canon_touch_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_qss_world_canon_touch on qss_world_canon;
create trigger trg_qss_world_canon_touch
  before update on qss_world_canon
  for each row execute function qss_world_canon_touch_updated_at();

-- ─── 4. qss_world_characters (canonical characters per world) ───────
--
-- A canonical character exists in a world even before Henry writes
-- about them. Burgundy, the Puppy King, the Queen — they have
-- canonical traits (species, role, motto, signature objects) that
-- AI must honor. When Henry mentions one of these names in a story,
-- the per-portrait endpoint can lookup canon and pin those traits.
--
-- This is the structural answer to the "Queen Scarlet IS a red dragon"
-- problem at scale — qss-canon.js currently hardcodes those rules.
-- Migrating that hardcoded data into this table would let canon be
-- editable without code changes.
create table if not exists qss_world_characters (
  id             uuid primary key default gen_random_uuid(),
  world_slug     text not null references qss_worlds(slug) on delete cascade,
  name_key       text not null,    -- lowercased canonical name
  name           text not null,    -- display name
  species        text default '',
  role           text default '',
  description    text default '',
  -- Hardlines the model must honor (e.g. "red dragon, not human queen")
  must_be        text default '',
  must_not_be    text default '',
  -- Free-form tags / signature objects / motto / etc.
  meta           jsonb default '{}'::jsonb,
  archived       boolean default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists idx_qss_world_char_unique
  on qss_world_characters (world_slug, name_key);
create index if not exists idx_qss_world_char_world
  on qss_world_characters (world_slug);

create or replace function qss_world_chars_touch_updated_at()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;
drop trigger if exists trg_qss_world_chars_touch on qss_world_characters;
create trigger trg_qss_world_chars_touch
  before update on qss_world_characters
  for each row execute function qss_world_chars_touch_updated_at();

-- ─── 5. Cross-world links (opt-in) ──────────────────────────────────
--
-- Eventually Burgundy and Queen Scarlet stories will intersect. A
-- simple link table — no enforcement, just metadata Henry can use
-- to tag scenes that bridge worlds. Lightweight on purpose; if the
-- multiverse story becomes complex, expand later.
create table if not exists qss_world_links (
  id              uuid primary key default gen_random_uuid(),
  from_world      text not null references qss_worlds(slug) on delete cascade,
  to_world        text not null references qss_worlds(slug) on delete cascade,
  link_type       text default 'reference', -- 'reference' | 'crossover' | 'aftermath' | etc.
  note            text default '',
  story_id        uuid references qss_stories(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_qss_world_links_from on qss_world_links(from_world);
create index if not exists idx_qss_world_links_to   on qss_world_links(to_world);

-- ─── 6. RLS (lockdown to service-role for now) ──────────────────────
-- Worlds, canon, and canonical characters are not user-editable from
-- the client in v1. The application server reads them via service-role
-- key. If we ever expose worlds-editing from the client, swap these
-- policies for authenticated-user-scoped ones.
alter table qss_worlds            enable row level security;
alter table qss_world_canon       enable row level security;
alter table qss_world_characters  enable row level security;
alter table qss_world_links       enable row level security;

-- Service-role bypasses RLS by default. No explicit policies needed
-- for v1; we'll add anon read policies once the client wants to fetch
-- world data directly.

-- ─── 7. Done. Verify with:
--   select slug, name, short_name from qss_worlds order by display_order;
--   select world_slug, count(*) from qss_stories group by world_slug;
--   select world_slug, count(*) from qss_cast    group by world_slug;
