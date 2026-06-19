-- Burma Script Tool — CLOUD SYNC (cloud-follow-me).
--
-- The doc has, until now, lived ONLY in one browser's localStorage. This table is the cloud
-- mirror so Johnny's script follows him to any browser/device/incognito and survives a wiped
-- laptop. localStorage stays the instant local cache + offline source of truth; this is the
-- durable copy the client pushes to on every save and reconciles against on load.
--
-- SINGLE canonical doc. The app writes/reads ONE row at a fixed id ('wp01-burma') — there is no
-- multi-doc concept in the tool. `version` mirrors the client's monotonic LS_DOC_VER stamp and is
-- the optimistic-concurrency token: the API only accepts a PUT whose incoming version is strictly
-- greater than the stored version, so an empty or older cloud copy can never overwrite good work.
--
-- No RLS / no auth: single-user tool, YouTube-public documentary work (non-sensitive), reached
-- ONLY through the serverless API which uses the RLS-bypassing service-role key. Adding RLS here
-- would do nothing but add a policy the service-role key ignores. Namespaced burma_* to coexist
-- with the project's other tables (matches 001_init.sql's convention).

create table if not exists public.burma_script_docs (
  id          text primary key,                 -- fixed canonical id, e.g. 'wp01-burma'
  doc         jsonb not null,                    -- the full editor doc JSON (rows → cells → blocks)
  version     bigint not null default 0,         -- mirrors client LS_DOC_VER; optimistic-concurrency token
  updated_at  timestamptz not null default now()
);
