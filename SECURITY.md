# Security posture

This document is the honest, plain-English security model for this repo. Written so a reviewer doesn't have to reverse-engineer it from code.

## TL;DR

- **Single-user app**, gated by a shared access code. Not multi-tenant. Not designed to be.
- **Threat model**: keep casual visitors out, keep API budget from being burned by anyone with the URL, never ship secrets in client bundles.
- **Not in scope**: per-user permissions, sharing, audit-by-identity, RLS-based isolation, SOC2.
- **Path to multi-tenant**: documented at the bottom — Supabase Auth + tightened RLS + per-row ownership. ~1–2 weeks of focused work.

## Auth model

There is one shared secret: the `ACCESS_CODE` env var. All entry surfaces verify it:

| Entry | Check |
|---|---|
| Browser modal at first visit | POSTs to `/api/access`. On match, code goes into `sessionStorage`. |
| Every `/api/*` call from the browser | A `fetch` wrapper installed at gate-success time injects `x-access-code` on every request. |
| `/api/transcribe`, `/api/claude`, `/api/gemini` | First line of the handler calls `checkAccess(req)`. Non-match → 401. |

If `ACCESS_CODE` isn't set in env, the gate runs in dev mode (open). This is intentional for local development; **do not deploy to production without setting `ACCESS_CODE`**.

The gate is **load-bearing** as of `e429699` — bypassing the modal does not grant `/api/*` access. Before that commit, the gate was cosmetic; verify your deployment includes the hardened version.

## Secrets

| Var | Where it's read | Sensitivity |
|---|---|---|
| `OPENAI_API_KEY` | Edge function `api/transcribe.js` only | high — server-side only |
| `DEEPGRAM_API_KEY` | Edge function `api/transcribe.js` only | high — server-side only |
| `ANTHROPIC_API_KEY` | Edge function `api/claude.js` only | high — server-side only |
| `GEMINI_API_KEY` | Edge function `api/gemini.js` only | high — server-side only |
| `SUPABASE_SERVICE_KEY` | Edge function `api/gemini.js` (Hunter helpers) and `tools/transcode-worker.ts` | **critical** — server/worker only, never bundled to client |
| `VITE_SUPABASE_URL` | Client bundle (intentional) | low — public URL |
| `VITE_SUPABASE_ANON_KEY` | Client bundle (intentional) | low — designed to be public; RLS protects data |
| `ACCESS_CODE` | Server-side only | high — the entire gate hinges on this |

`.env.local` is gitignored (`.env*.local` in `.gitignore`). Verified via `git log --all --diff-filter=A --name-only | grep env` — never committed to history.

If any of the high-sensitivity vars leak: rotate at the provider, redeploy with new value, no migration needed.

## Database (Supabase)

- **RLS is permissive** (`using (true) with check (true)` for the anon role on most tables). For a single-user app this is intentional — there is no second user to isolate from. The gate + the anon-key model assume "if you have the URL and the access code, you're Johnny."
- All client queries use the anon key. The service-role key is only in the edge function and the worker.
- **No client-side direct access without the anon key.** A bare `curl` against the Supabase REST API requires the anon key (which is in the bundle, but only readable by someone past the gate).
- The realistic attack on this design: someone who already has the access code can also tinker with the DB. We accept that — they're the user.

## Storage

- Supabase Storage bucket `media`. Files written under `<projectId-or-unattached>/<timestamp>-<safe-name>`.
- Signed URLs (4-hour expiry) for read access; never expose direct unsigned bucket URLs to clients.
- Bucket size: 5 GB cap configured in Supabase.

## Edge function defenses

Recent hardening (commit `e429699`):

- **Gate enforced on every proxy** (`api/transcribe.js`, `api/claude.js`, `api/gemini.js`).
- **SSRF closed** in `api/transcribe.js` — `mediaUrl` must be `http(s)://`. Previously could be `file://` or any internal address.
- **API-key echo redacted** — provider error responses (Whisper, Deepgram) sometimes echo the API key back in their error text. `redactApiErrorText()` strips OpenAI keys, Bearer tokens, hex blobs, and JWTs before they leave the server.
- **PostgREST filter injection closed** in `api/gemini.js` — every `eq.${value}` interpolation runs the value through `pgrEscape()` (`encodeURIComponent`). Previously a caller could inject extra filter clauses by pasting `&tier=eq.foo` into a project_id.

Still TODO (logged, not yet shipped):
- Per-IP rate limiting on `/api/transcribe` and `/api/claude` to limit cost-bomb damage if the access code ever leaks.
- Cleanup cron for orphaned `media_uploads` rows whose linked transcript was never saved (tab close mid-upload).

## What I'd change to go multi-tenant

If we ever onboard a second human (a colleague, contractor, client):

1. **Replace the shared-secret gate with Supabase Auth** (magic link or Google OAuth). Every transcript row gets a `created_by` user FK.
2. **Tighten RLS** — every table policy gates by `auth.uid() = created_by` or membership of a `workspace_members` table.
3. **Workspace + sharing model** — orgs/teams as the top-level container; per-row sharing UI; viewer/editor/owner roles.
4. **Remove `service_role` usage from `api/gemini.js`** — replace with anon-key reads gated by RLS.
5. **Switch `releaseLockBeacon` from anon-key DELETE to a session-token DELETE** — currently broadcasts the anon key in plaintext on every tab close.
6. **Storage path randomization** — current paths are predictable (`<projectId>/<timestamp>-<name>`). Salt with random bytes once we have multi-tenant access patterns to worry about.
7. **Audit log** — `transcript_revisions` already has `client_label` + `client_color`; once users exist, attribute by `auth.uid()` instead and surface in the History UI.

This is roughly 1–2 weeks of focused work. The current architecture deliberately stops one step short of all of this.
