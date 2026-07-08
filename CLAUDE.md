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
- **🛑 LIVE-COLLAB TESTING LAW (incident 2026-07-08 — clobbered Johnny's live Burma script):** the collab room id is `script-<episode.id>` (collab.js `roomIdFor`) — it is FIXED BY THE EPISODE, **not** the URL hash, not the origin, not localhost. So opening an EDITABLE build of a collab episode (burma, palau, any `collab:true`) from ANYWHERE — localhost, a `#scratch-whatever` slug, a dev deploy — connects to the SAME production Liveblocks room and every keystroke syncs into Johnny's live document. A `#scratch-*` hash does NOT isolate the room; it only changes which library entry the library UI shows. **NEVER open an editable build of a `collab:true` episode to test/verify.** To verify editor behavior on a collab project, use ONE of: (1) a `?read` share link (structurally write-incapable), (2) a NON-collab scratch episode (`collab:false`), or (3) a collab episode whose room is environment-namespaced away from prod. Also: **never `fill()` a ProseMirror editor** in Playwright/Interceptor — `fill` REPLACES the whole doc (it wiped the scratch instantly); use `pressSequentially`/real keystrokes at a caret. Recovery when it happens: the full doc lives in `public.script_doc_revisions` (append-only ledger) — find the last large revision, restore `script_docs`, delete the Liveblocks room (with 0 clients connected) so it re-seeds from the good cloud copy.
