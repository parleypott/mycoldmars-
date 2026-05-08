-- Global script training results (not per-project)
-- Stores the learned understanding from cross-script analysis

create table if not exists script_training (
  id uuid primary key default gen_random_uuid(),
  doc_count integer not null default 0,
  doc_titles jsonb default '[]',           -- Array of {docId, title, beats, words} for all training docs
  color_rules jsonb default '[]',          -- Array of {color, meaning, confidence, consistency, exceptions}
  sloppiness_patterns jsonb default '[]',  -- Array of {pattern, frequency, workaround}
  structural_patterns jsonb,
  voice_style jsonb,
  visual_direction_style jsonb,
  script_context text,                     -- The 3-4 paragraph learned context
  style_signature text,                    -- One-sentence personality capture
  model text not null default 'gemini-2.5-flash',
  created_at timestamptz default now()
);

-- Only keep the latest few training runs
create index if not exists idx_script_training_created
  on script_training(created_at desc);
