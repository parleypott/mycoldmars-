-- ════════════════════════════════════════════════════════════════════
-- 030_novel_tool.sql
--
-- Schema for the Newpress Novel tool at mycoldmars.com/novel.
--
-- Strategy: schema is defined NOW so cloud sync (v2) can land without
-- a migration. v0/v1 of the app run local-first against IndexedDB and
-- never touch Supabase. v2 turns on a one-way push, then full sync.
--
-- Markdown at the core. Every body field is plain text — exportable
-- to .md any time, zero lock-in.
--
-- RLS: enabled, locked to authenticated. v2 will gate by owner_email
-- (same pattern as qss_stories).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── novels ──
create table if not exists public.novel_novels (
  id              uuid primary key default gen_random_uuid(),
  owner_email     text,
  title           text not null default 'untitled',
  subtitle        text,
  blurb           text,                  -- short pitch / logline
  voice_sample    text,                  -- author voice — write like THIS
  cover_summary   text,                  -- one-pager
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ── chapters ──
create table if not exists public.novel_chapters (
  id              uuid primary key default gen_random_uuid(),
  novel_id        uuid not null references public.novel_novels(id) on delete cascade,
  position        integer not null default 0,
  act             text,                  -- "I" | "II" | "III" or freeform
  title           text not null default 'untitled chapter',
  summary         text,
  status          text not null default 'draft', -- draft | first-pass | revised | final
  word_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists idx_novel_chapters_novel on public.novel_chapters(novel_id, position);

-- ── scenes ──
-- Scenes are the unit of editing. A chapter is a sequence of scenes.
-- prose is plain text (with [[ ]] directives inline as user authors).
create table if not exists public.novel_scenes (
  id                uuid primary key default gen_random_uuid(),
  chapter_id        uuid not null references public.novel_chapters(id) on delete cascade,
  novel_id          uuid not null references public.novel_novels(id) on delete cascade,
  position          integer not null default 0,
  title             text,
  summary           text,
  prompt            text,                -- outline-level prompt for this scene
  prose             text not null default '',
  status            text not null default 'draft',
  word_count        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists idx_novel_scenes_chapter on public.novel_scenes(chapter_id, position);
create index if not exists idx_novel_scenes_novel on public.novel_scenes(novel_id);

-- ── codex entries ──
-- The story bible. Characters, places, objects, concepts, themes.
-- These get loaded into every AI prompt for consistency.
create table if not exists public.novel_codex (
  id                uuid primary key default gen_random_uuid(),
  novel_id          uuid not null references public.novel_novels(id) on delete cascade,
  kind              text not null,       -- character | place | object | concept | theme
  name              text not null,
  aliases           text[] not null default '{}',
  one_line          text,                -- single-sentence summary
  full_text         text,                -- the deep description
  color             text,                -- hex for visual tagging
  image_url         text,                -- optional, not core
  first_appearance_scene_id  uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists idx_novel_codex_novel_kind on public.novel_codex(novel_id, kind);

-- ── generations log ──
-- Every AI generation logged: directive, before, after, tokens, cost.
-- Lets us show a real cost meter and reconstruct revision history.
create table if not exists public.novel_generations (
  id                uuid primary key default gen_random_uuid(),
  novel_id          uuid not null references public.novel_novels(id) on delete cascade,
  scene_id          uuid references public.novel_scenes(id) on delete set null,
  kind              text not null,       -- bracket | highlight | outline-prompt
  directive         text not null,
  before_text       text,
  after_text        text,
  model             text not null,       -- claude-sonnet-4-6 | claude-opus-4-7
  tokens_in         integer not null default 0,
  tokens_cache_w    integer not null default 0,
  tokens_cache_r    integer not null default 0,
  tokens_out        integer not null default 0,
  cost_usd          numeric(10,5) not null default 0,
  accepted          boolean,
  created_at        timestamptz not null default now()
);
create index if not exists idx_novel_gen_novel on public.novel_generations(novel_id, created_at desc);

-- ── updated_at trigger ──
create or replace function public.novel_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['novel_novels','novel_chapters','novel_scenes','novel_codex']) loop
    execute format('drop trigger if exists trg_touch_%I on public.%I', t, t);
    execute format('create trigger trg_touch_%I before update on public.%I for each row execute function public.novel_touch_updated_at()', t, t);
  end loop;
end $$;

-- ── RLS ──
-- Locked to authenticated. v2 will add per-owner_email row policies.
-- For now nothing reads/writes from the client; the API endpoints use
-- the service role key only.
alter table public.novel_novels       enable row level security;
alter table public.novel_chapters     enable row level security;
alter table public.novel_scenes       enable row level security;
alter table public.novel_codex        enable row level security;
alter table public.novel_generations  enable row level security;

-- explicit deny-by-default for anon/authenticated; service role bypasses RLS.
do $$
declare t text;
begin
  for t in select unnest(array['novel_novels','novel_chapters','novel_scenes','novel_codex','novel_generations']) loop
    execute format('drop policy if exists %I_all_deny on public.%I', t, t);
    execute format('create policy %I_all_deny on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t, t);
  end loop;
end $$;

-- ── done ──
-- Reminder: apply this in v2, not v0. v0 ships local-only.
