-- Sharing model. Workspace mode still applies (everyone signed in sees
-- everything), so this migration is mostly a DATA model for explicit
-- collaborator lists: who's been invited to a specific transcript, with
-- what role. The UI uses this to:
--
--   • Show a list of named collaborators on a transcript
--   • Distinguish "owner / editor / viewer" intent
--   • Drive activity feed and presence ordering ("4 collaborators on this")
--   • Lay groundwork for later when we flip to per-user RLS scoping
--
-- For now the policies remain permissive across signed-in users — the
-- model exists, the enforcement waits.

create table if not exists transcript_shares (
  id              uuid primary key default gen_random_uuid(),
  transcript_id   text not null references transcripts(id) on delete cascade,
  -- Either user_id (existing user) OR email (pending invite for someone
  -- who hasn't signed in yet). Exactly one of the two should be set.
  user_id         uuid references auth.users(id) on delete cascade,
  email           text,
  role            text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Acceptance state — pending invites stay 'pending' until the email
  -- recipient signs up and gets matched by trigger.
  status          text not null default 'active' check (status in ('active','pending','revoked')),
  -- Optional last-seen / last-edit denorm so the Share dialog can show
  -- "Brad — last edited 3h ago" without a join.
  last_seen_at    timestamptz,
  -- Soft constraints: cannot have BOTH user_id and email null.
  constraint shares_target_chk check (user_id is not null or email is not null)
);

-- Lookups: by transcript (most common — Share dialog), by user (their
-- shared list), by email (for matching pending invites at signup).
create unique index if not exists idx_shares_unique_user
  on transcript_shares (transcript_id, user_id)
  where user_id is not null;
create unique index if not exists idx_shares_unique_email
  on transcript_shares (transcript_id, lower(email))
  where email is not null;
create index if not exists idx_shares_transcript on transcript_shares (transcript_id);
create index if not exists idx_shares_user       on transcript_shares (user_id);
create index if not exists idx_shares_email      on transcript_shares (lower(email));

-- When a user signs up whose email matches a pending invite, promote
-- the row to (user_id, status='active').
create or replace function promote_pending_share_invites()
returns trigger
language plpgsql
security definer
as $$
begin
  update transcript_shares
     set user_id    = new.id,
         status     = 'active',
         updated_at = now()
   where email      is not null
     and user_id    is null
     and lower(email) = lower(new.email);
  return new;
end;
$$;

drop trigger if exists tr_promote_pending_shares on auth.users;
create trigger tr_promote_pending_shares
  after insert on auth.users
  for each row execute function promote_pending_share_invites();

alter table transcript_shares enable row level security;

-- Permissive workspace policies — every signed-in user can read/write.
-- The data model exists for client-side UX; enforcement comes later.
drop policy if exists shares_read_all on transcript_shares;
create policy shares_read_all on transcript_shares
  for select using (auth.uid() is not null);

drop policy if exists shares_write_all on transcript_shares;
create policy shares_write_all on transcript_shares
  for all using (auth.uid() is not null)
       with check (auth.uid() is not null);

-- Touch updated_at on any UPDATE so the Share dialog can sort sensibly.
create or replace function touch_share_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_touch_shares_updated_at on transcript_shares;
create trigger tr_touch_shares_updated_at
  before update on transcript_shares
  for each row execute function touch_share_updated_at();
