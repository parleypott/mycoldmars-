-- Hunter Phase 2 — Scenes & Training Mode
-- Adds hierarchical scene grouping for the Scene Playground.
-- Scenes are modular buckets of corpus_units that can be:
--   - Viewed as collapsible cards on a grid board
--   - Ordered linearly (as shot) or rearranged by the editor
--   - Clicked into to see constituent clips
--   - Synthesized by Gemini Pro for arc understanding
--
-- Also adds project mode (training vs active) for different analysis behaviors.

-- ═══════════════════════════════════════════════════════════
-- Scenes — modular groupings of footage moments
-- ═══════════════════════════════════════════════════════════
create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hunter_projects(id) on delete cascade,

  -- Identity
  name text not null,                     -- "Arriving at NEOM", "Interview with the merchant"
  description text,                       -- Editor's notes or auto-generated summary
  scene_type text,                        -- 'location', 'interview', 'b-roll-sequence', 'on-camera',
                                          -- 'transition', 'montage', 'establishing', etc.

  -- Temporal / shoot metadata
  shoot_day text,                         -- "Day 1", "Oct 5 2024"
  location text,                          -- "NEOM construction site", "Riyadh old quarter"
  time_of_day text,                       -- "morning", "golden hour", "night"

  -- Ordering
  chronological_order integer not null default 0,  -- As-shot order (auto-assigned from clip timestamps)
  board_order integer,                             -- User-arranged order in scene playground

  -- Grid board positioning (for the scene playground canvas)
  board_x numeric default 0,
  board_y numeric default 0,
  board_width numeric default 1,          -- Grid units wide (cards can be resized)
  board_height numeric default 1,         -- Grid units tall
  collapsed boolean default true,         -- Card collapsed/expanded state on board

  -- AI synthesis (filled by Pro passes after cataloging)
  arc_summary text,                       -- "How this scene unfolded" — narrative arc prose
  emotional_curve text,                   -- "Builds from curiosity → tension → quiet awe"
  editorial_notes text,                   -- AI observations about this scene's potential

  -- Aggregate stats (updated when units are added/removed)
  clip_count integer default 0,
  total_duration_seconds integer default 0,

  -- Status
  status text default 'auto'
    check (status in ('auto', 'confirmed', 'merged', 'split', 'archived')),
    -- auto: created by AI grouping pass
    -- confirmed: user has reviewed and accepted
    -- merged: combined with another scene
    -- split: broken into smaller scenes
    -- archived: set aside, not in active consideration

  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- Scene ↔ Corpus Unit join table
-- A clip can belong to multiple scenes (same establishing shot
-- might be relevant to two narrative threads).
-- Position tracks order within the scene.
-- ═══════════════════════════════════════════════════════════
create table if not exists scene_units (
  scene_id uuid not null references scenes(id) on delete cascade,
  corpus_unit_id uuid not null references corpus_units(id) on delete cascade,
  position integer not null default 0,    -- Order within the scene
  role text,                              -- 'hero', 'supporting', 'cutaway', 'establishing', 'transition'
  notes text,                             -- Per-clip-in-scene editorial notes
  primary key (scene_id, corpus_unit_id)
);

-- ═══════════════════════════════════════════════════════════
-- Scene conversations — chat history per scene
-- For the future chatbot interface where user discusses
-- editorial decisions about specific scenes.
-- ═══════════════════════════════════════════════════════════
create table if not exists scene_conversations (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb default '{}',            -- Could hold referenced unit IDs, suggestions, etc.
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- Project arc summaries — hierarchical synthesis output
-- scene-level → day-level → project-level narratives
-- ═══════════════════════════════════════════════════════════
create table if not exists arc_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hunter_projects(id) on delete cascade,
  level text not null check (level in ('scene', 'day', 'project')),
  scope_ref text,                         -- scene_id, "Day 3", or "full project"
  summary_text text not null,             -- Prose arc narrative
  model text not null,                    -- Which Gemini model wrote this
  input_summary_ids uuid[] default '{}',  -- Child summaries that fed into this one
  created_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════
create index if not exists idx_scenes_project on scenes(project_id);
create index if not exists idx_scenes_chrono on scenes(project_id, chronological_order);
create index if not exists idx_scenes_board on scenes(project_id, board_order);
create index if not exists idx_scene_units_scene on scene_units(scene_id);
create index if not exists idx_scene_units_unit on scene_units(corpus_unit_id);
create index if not exists idx_scene_convos_scene on scene_conversations(scene_id);
create index if not exists idx_arc_summaries_project on arc_summaries(project_id);

-- ═══════════════════════════════════════════════════════════
-- RLS: same open pattern as phase 1
-- ═══════════════════════════════════════════════════════════
alter table scenes enable row level security;
alter table scene_units enable row level security;
alter table scene_conversations enable row level security;
alter table arc_summaries enable row level security;

create policy "anon_all" on scenes for all using (true) with check (true);
create policy "anon_all" on scene_units for all using (true) with check (true);
create policy "anon_all" on scene_conversations for all using (true) with check (true);
create policy "anon_all" on arc_summaries for all using (true) with check (true);
