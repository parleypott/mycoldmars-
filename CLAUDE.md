# mycoldmars

Preact + Vite app. Supabase backend, Vercel hosting. Solo repo — commit and push freely.

## Commands
- **dev:** `bun run dev` (vite)
- **build:** `bun run build` (vite build)
- **verify:** `bun run verify` — builds the app; if it passes, the bundle is sound. (No standalone typechecker installed — Vite/esbuild compiles the TS. Add `typescript` + a `tsconfig.json` if you want real `tsc --noEmit`.)
- **deploy:** Vercel auto-deploys from `main`. Push = ship.

## Secrets
Supabase service_role key + Vercel scope live at `~/.config/mycoldmars/secrets.env`. Source it for autonomous DB/deploy ops — never re-ask.

## Gotchas
- **`${HOME}` literal-dir trap:** this repo has a history of a literal `${HOME}` directory getting created and staged. ALWAYS `git status` before `git add -A` — never blanket-stage without scanning first.
- A Stop hook runs `bun run verify` automatically when you end a turn inside this repo; build failures land in `/tmp/verify-mycoldmars.log`.
- **COLLAB LOOP LAW (incident 2026-07-07):** the burma script project runs Liveblocks+Yjs — every y-sync apply is a FULL-DOC change. Any plugin that dispatches automatic transactions (appendTransaction, auto-repair, normalizers) can re-fire on the remote echo of its own edit and lock the tab in a dispatch loop. NEVER ship one enabled for collab sessions without first testing it against a real collab room (create a scratch library project, flip collab on for it, two headless browsers, type + watch the main thread). `?read` pages and non-collab scratch projects DO NOT exercise this path and prove nothing about it.
