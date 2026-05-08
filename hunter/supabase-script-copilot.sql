-- Script Copilot tables for Hunter
-- Versioned rich document snapshots + specialized analysis passes

-- Versioned rich document snapshots
create table if not exists script_snapshots (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  revision_id text,
  version_number integer not null,
  parsed_doc jsonb not null,        -- Full intermediate format from parser
  color_profile jsonb,              -- Observed colors + counts + samples
  beat_count integer default 0,
  word_count integer default 0,
  created_at timestamptz default now()
);

-- Index for fast lookups by media asset
create index if not exists idx_script_snapshots_asset
  on script_snapshots(media_asset_id);

-- Unique constraint: one version per asset+version_number
create unique index if not exists idx_script_snapshots_version
  on script_snapshots(media_asset_id, version_number);

-- Specialized analysis pass results
create table if not exists script_passes (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references script_snapshots(id) on delete cascade,
  pass_type text not null check (pass_type in (
    'animation_audit',
    'archive_audit',
    'fact_check',
    'pacing_analysis',
    'coherence_check',
    'full_synthesis',
    'script_training'
  )),
  output_json jsonb not null,
  output_text text,
  model text not null,
  created_at timestamptz default now()
);

-- Index for fast lookups by snapshot
create index if not exists idx_script_passes_snapshot
  on script_passes(snapshot_id);

-- Index for filtering by pass type
create index if not exists idx_script_passes_type
  on script_passes(pass_type);
