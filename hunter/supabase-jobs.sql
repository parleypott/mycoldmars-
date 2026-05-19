-- Job queue for Hunter operations
-- Allows the web UI to trigger long-running jobs that the local worker executes

create table if not exists hunter_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null, -- ingest_selects, compute_decisions, train_taste, run_synthesis, backfill_analyses
  status text not null default 'pending', -- pending, running, completed, failed
  project_id uuid references hunter_projects(id) on delete cascade,
  params jsonb default '{}',
  progress jsonb default '{}', -- { phase, pct, message }
  result jsonb default '{}',
  error text,
  created_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_hunter_jobs_status on hunter_jobs(status);
create index if not exists idx_hunter_jobs_created on hunter_jobs(created_at desc);

alter table hunter_jobs enable row level security;
create policy "anon_all" on hunter_jobs for all using (true) with check (true);

-- Storage bucket for selects XML uploads
-- Run this in the Supabase dashboard under Storage:
-- Create a new bucket called "hunter-uploads" with public access
