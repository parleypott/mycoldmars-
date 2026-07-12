-- Reader highlights + notes for the BERGUNDY iPad reading experience
-- (mycoldmars.com/burgundy). Single-reader, no auth — service key only.
create table if not exists burgundy_notes (
  id uuid primary key default gen_random_uuid(),
  book_version text not null default '',
  chapter_idx int not null default 0,
  para_key text not null,
  quote text not null,
  prefix text default '',
  note text default '',
  color text default 'amber',
  reader text default 'reader',
  resolved boolean default false,
  created_at timestamptz default now()
);
create index if not exists burgundy_notes_created_idx on burgundy_notes (created_at desc);
alter table burgundy_notes enable row level security;
