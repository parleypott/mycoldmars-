-- Multi-user foundation. Adds Supabase Auth support without changing the
-- collaboration model: this is a SHARED WORKSPACE — every signed-in user
-- sees the same library, the same projects, the same media. The point of
-- adding auth here is functional, not access control:
--
--   • Every save is attributed to a real user (created_by, last_edited_by)
--   • Revisions show 'Brad edited this 4h ago' instead of opaque tab IDs
--   • Realtime presence shows real names + colors
--   • Speaker renames carry user identity for audit
--   • Conflict resolution can name who has the lock
--
-- Per-user scoping (private libraries, sharing/permissions) is a SEPARATE
-- migration we'll do later. For now: workspace-style — log in, see everything.
--
-- Existing rows have created_by = NULL — still visible to all signed-in
-- users. New rows get the inserter's auth.uid().

-- ── Profile metadata per user ──
-- Mirrors the auth.users.id and adds the bits the app actually needs to
-- render: a display name and a stable color. Auto-populated from the
-- email's local-part on first sign-in via the trigger below.
create table if not exists user_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email        text,
  color        text not null default '#dd2c1e',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function bootstrap_user_profile()
returns trigger
language plpgsql
security definer
as $$
declare
  guess_name text;
begin
  -- Pick a sensible default display name from the email local-part.
  guess_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1),
    'User'
  );
  insert into user_profiles (user_id, display_name, email, color)
    values (
      new.id,
      guess_name,
      new.email,
      -- Pick a color from the brand palette deterministically by hashing
      -- the user id so a person's color stays stable across sessions.
      (array['#dd2c1e','#004cff','#0d5921','#ffbf00','#6b5ce7','#e85d04','#412c27','#a83279'])
        [(abs(hashtext(new.id::text)) % 8) + 1]
    )
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tr_bootstrap_user_profile on auth.users;
create trigger tr_bootstrap_user_profile
  after insert on auth.users
  for each row execute function bootstrap_user_profile();

-- Backfill: any existing auth users without a profile get one now.
insert into user_profiles (user_id, display_name, email, color)
  select id,
         coalesce(raw_user_meta_data->>'full_name', split_part(email, '@', 1), 'User'),
         email,
         (array['#dd2c1e','#004cff','#0d5921','#ffbf00','#6b5ce7','#e85d04','#412c27','#a83279'])
           [(abs(hashtext(id::text)) % 8) + 1]
    from auth.users
  on conflict (user_id) do nothing;

alter table user_profiles enable row level security;

-- Anyone signed in can read all profiles (workspace model).
drop policy if exists profiles_read_all on user_profiles;
create policy profiles_read_all
  on user_profiles for select
  using (auth.uid() is not null);

-- Users can update only their own row.
drop policy if exists profiles_update_self on user_profiles;
create policy profiles_update_self
  on user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Attribution columns on the workspace tables ──
-- Nullable on purpose: the existing rows from the pre-auth era stay
-- visible. New inserts get auth.uid() via the app layer (see db.js).
alter table transcripts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table transcripts add column if not exists last_edited_by uuid references auth.users(id) on delete set null;
alter table projects    add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table media_uploads add column if not exists uploaded_by uuid references auth.users(id) on delete set null;

create index if not exists idx_transcripts_created_by on transcripts (created_by);
create index if not exists idx_projects_created_by    on projects (created_by);
create index if not exists idx_media_uploaded_by      on media_uploads (uploaded_by);

-- Attribute every revision to the user who saved it (for the History modal +
-- audit). Nullable for backfill of pre-auth revisions.
alter table transcript_revisions add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists idx_revisions_user_id on transcript_revisions (user_id);

-- RLS policies remain permissive across the workspace (any signed-in user
-- can read/write everything). Per-user scoping comes in a later migration
-- alongside the sharing UI.
