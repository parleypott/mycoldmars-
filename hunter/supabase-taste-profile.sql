-- Editorial taste profile tables
-- Closes the feedback loop: learn from editorial decisions across projects

-- Per-clip kept/discarded outcomes (extracted from cross-tier matching)
create table if not exists editorial_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hunter_projects(id) on delete cascade,
  corpus_unit_id uuid not null references corpus_units(id) on delete cascade,
  kept boolean not null,
  usage_count integer not null default 0,
  shot_type text,
  camera_movement text,
  lighting text,
  audio_quality text,
  emotional_register text,
  editorial_function text,
  keepability_score real,
  keepability_reason text,
  source_clip_name text,
  created_at timestamptz default now(),
  unique(project_id, corpus_unit_id)
);

create index if not exists idx_editorial_decisions_project
  on editorial_decisions(project_id);
create index if not exists idx_editorial_decisions_kept
  on editorial_decisions(kept);

-- Global cross-project taste profile (same pattern as script_training)
create table if not exists taste_profile (
  id uuid primary key default gen_random_uuid(),
  project_count integer not null default 0,
  clip_count integer not null default 0,
  project_ids jsonb default '[]',
  shot_preferences jsonb default '{}',
  keepability_calibration jsonb default '{}',
  editorial_rules jsonb default '[]',
  negative_patterns jsonb default '[]',
  mismatch_insights jsonb default '[]',
  taste_context text,
  taste_signature text,
  model text not null default 'gemini-2.5-flash',
  created_at timestamptz default now()
);

create index if not exists idx_taste_profile_created
  on taste_profile(created_at desc);
