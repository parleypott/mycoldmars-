-- Devchat — in-product feedback + chat threads.
--
-- The shape is "thread + messages": a thread captures the page state at
-- the moment the user opened the chat (URL, transcript context,
-- screenshot reference), and messages stream in from BOTH the user and
-- an AI assistant. The autonomous code-fixer worker (v2) reads open
-- threads, makes edits, and posts back into the same message stream so
-- the user sees status updates inline.
--
-- Permissive workspace RLS for now — anyone signed in can read/write.

create table if not exists devchat_threads (
  id              uuid primary key default gen_random_uuid(),
  transcript_id   uuid references transcripts(id) on delete set null,
  page_url        text not null,
  page_state      jsonb,                       -- viewport, current step, etc.
  screenshot_path text,                        -- supabase storage path, optional
  title           text,                        -- short summary, derived from first message
  status          text not null default 'open' check (status in ('open','in_progress','shipped','closed')),
  commit_sha      text,                        -- once worker ships a fix
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_devchat_threads_status     on devchat_threads (status);
create index if not exists idx_devchat_threads_created_by on devchat_threads (created_by);
create index if not exists idx_devchat_threads_updated    on devchat_threads (updated_at desc);

create table if not exists devchat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references devchat_threads(id) on delete cascade,
  -- 'user' = principal typing in the box
  -- 'assistant' = Claude reply via /api/devchat-respond
  -- 'system' = automated status (worker started, build green, deploy ok)
  -- 'agent' = autonomous code-fixer running locally (v2)
  sender      text not null check (sender in ('user','assistant','system','agent')),
  body        text not null,
  metadata    jsonb,                           -- diffs, tool calls, file refs
  created_at  timestamptz not null default now()
);

create index if not exists idx_devchat_messages_thread on devchat_messages (thread_id, created_at);

-- Touch the thread's updated_at + clear shipped/closed when a new user
-- message lands. Keeps "what's actively being worked on" sortable.
create or replace function touch_devchat_thread()
returns trigger
language plpgsql
as $$
begin
  update devchat_threads
     set updated_at = now(),
         -- a new user message reopens a closed/shipped thread
         status = case when new.sender = 'user' and status in ('shipped','closed') then 'open' else status end
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists tr_touch_devchat_thread on devchat_messages;
create trigger tr_touch_devchat_thread
  after insert on devchat_messages
  for each row execute function touch_devchat_thread();

alter table devchat_threads  enable row level security;
alter table devchat_messages enable row level security;

drop policy if exists devchat_threads_all  on devchat_threads;
create policy devchat_threads_all  on devchat_threads
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

drop policy if exists devchat_messages_all on devchat_messages;
create policy devchat_messages_all on devchat_messages
  for all using (auth.uid() is not null) with check (auth.uid() is not null);
