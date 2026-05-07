# Newpress Interpreter — Debug Pass Report

*Generated: 2026-05-07. Scope: this multi-day session of bug-hunting + structural fixes on the `translation/` app.*

---

## What this app is

A Trint-replacement transcription editor for a single user (Johnny). Pipeline: drop video/audio → upload to Supabase Storage → transcribe via Whisper or Deepgram (`/api/transcribe` Edge function, prefers Deepgram when configured) → optional translate via Claude → edit in TipTap (Prosemirror) → export to SRT, Premiere XML markers, or Sacred Sequencer FCP XML. Pinned media deck (video + waveform) stays in sync with playback. Autosave to Supabase with a localStorage snapshot safety net.

Stack: Vite + Preact + TipTap + Supabase + tus-js-client + wavesurfer v7. Vanilla JS, not TypeScript. Vercel auto-deploys from `main`.

Repo: `/Users/johnnyharris/playground/mycoldmars` · GitHub: `parleypott/mycoldmars-` · Live: `mycoldmars.com` (and the per-deployment Vercel preview URLs).

---

## What got shipped this session

Roughly chronological. All commits on `main`, all deployed.

### Build out — the core flow

| Commit | What |
|---|---|
| `24a07a6` | New upload flow — stats dialog → TRANSCRIBE → speaker labeling (Trint-inspired) |
| `45e747e` | Redesigned upload dialogs in the step pattern (file pills, language pickers, hints) |
| `3d9ddce` | Fix transparent modal + missing media deck on first entry |
| `7572cfa` | Trint-style media deck controls — skip-back-10 / play / skip-forward-10 / time / speed |
| `b04311f` | Click-to-rename speaker (body), plain-click-to-seek, stronger playback highlight |
| `10136d1` | Compress edit page header, wire translate-on-media-upload, codec fallback, bilingual rendering |
| `7bdbff0` | Audio-only overlay was covering controls + tighten editor margins |

### Audit-driven fixes

| Commit | What |
|---|---|
| `0f28b4d` | Six verified bugs from parallel audits: undefined `--np-space-5` token, dead `.export-header` CSS, 64px speaker margin → 32px, visibilitychange missing 'conflict' state, np-speaker-rename markDirty, mountMediaDeck destroy() leaking 5 listeners |
| `a25c653` | Snapshot recovery silently dropped `mediaUploadId`/`projectId`/`targetLanguage`/`translationEnabled`/`step` — fixed; first onSpeakerMapChange callsite unified through np-speaker-rename |
| `87e5a91` | Second `onSpeakerMapChange` callsite (different indentation, missed by replace_all); `formatTimecodeForTag` now compact (M:SS instead of HH:MM:SS.mmm) |
| `8080a14` | Pre-transcribe dialog Escape-keydown listener leak |
| `9ff470e` | P0-3 cross-transcript leak (summary/votes/workshop bleeding between transcripts), P1-12 resetToUpload race, P3-9 magic 50ms timeout → flushPendingSave, P3-18 workshop polished text vanishing |

### Deeper invasive structural fixes

| Commit | What |
|---|---|
| `003b4ed` | Pre-id draft snapshot system (P0-4 — biggest data-loss safety net), media deck stays alive across editor↔workshop toggle (P1-1), viewOnly now disables editor input (P0-1), revision-restore zeros state before applying (P0-6), pendingMediaUploadId cleared after first save (P1-11), ProRes codec error code 4 → audio-only fallback (P2-4), speaker-dialog audio fetch teardown (P2-3), body class cleanup on destroy mid-drag (P2-6) |
| `d2b3d62` | Claude Sonnet model bumped from `claude-sonnet-4-20250514` → `claude-sonnet-4-6` in 6 callsites; lock-release on tab-close uses fetch keepalive:true via new `releaseLockBeacon()` (was getting killed mid-tab-close); highlight refresh throttled to 250ms |
| `916c12f` | **Critical:** Hunter sub-app's missing `fetchNarrativeInsights` export was breaking the entire Vercel build silently. Several recent commits weren't actually deploying. Fixed. |
| `d5516b4` | EditorBubbleMenu blur listener leak — anonymous arrow function never detached on unmount |

---

## Where it stands

### Working

- Upload → transcribe → speaker-label → editor flow end-to-end
- Bilingual rendering when a translate target is picked (original under translated, smaller serif italic)
- Trint-style media controls (skip-back-10, play, skip-forward-10, time, speed) with prominent play button
- Audio-only fallback for ProRes proxies (Chrome can't decode → "AUDIO ONLY" panel; audio + waveform + transcript still work)
- Click anywhere in transcript → playhead snaps to that word; cursor still positions for editing
- Click speaker label (in body OR in chip panel) → prompt → renames everywhere, autosaves
- Moving playback highlight that auto-scrolls
- J/K/L Final-Cut keyboard shortcuts; arrows seek 10s
- Drag the media deck around; collapse with `−`
- Cached waveform peaks persist in `media_uploads.waveform` (instant load on second open)
- Autosave with snapshot recovery for failed-save scenarios — including the **pre-id window** between upload and first save
- View-only mode actually locks the editor when another tab holds the lock
- Reliable lock release on tab close (fetch keepalive)

### Known gaps + bugs not yet fixed

Verified real, deferred for invasiveness or low-frequency:

| ID | What | Why not fixed |
|---|---|---|
| **P0-2** | 3-tab realtime race — tab1 saves A, tab3 saves C while tab1 has B in flight; tab1's realtime channel can clobber B with C | Needs sequence-number tracking, only triggers in 3+ concurrent tabs (rare for solo user) |
| **P0-5** | `runSaveOnce({ awaitInFlight: true })` busy-loop has no wall-clock timeout | Can't actually deadlock with current code; smell more than bug |
| **P1-7** | Editor.jsx `useEffect([initialContent])` does `JSON.stringify(editor.getJSON())` compare on every prop change | Only slow on huge transcripts; needs content-version counter |
| **P3-3** | Snapshot-restore prompt always offers when `dirty=true`, even if server is meaningfully newer | UX paper cut; user can read both timestamps in the prompt |
| **P3-15** | Signed URL for transcription expires at 4h — could fail mid-transcription on multi-GB files | Edge case; would need separate URL minting for transcribe vs. editing |
| — | Premiere XML export hardcoded 24fps timebase | Most Newpress footage is 23.976; needs an opt or auto-detect |

### Things I haven't audited at all

- `BubbleMenu.jsx` (only one bug fixed; rest unread)
- `TagPicker.jsx`
- `copilot/CopilotPanel.jsx` (most of it)
- `copilot/SummaryView.jsx`
- `export/pdf-export.js`
- `export/premiere-script.js`
- `export/summary-export.js`
- `tags/` directory
- `sot-hunter.js` (briefly — only checked listener counts)
- `command-palette.js`
- `csv-parser.js` / `json-parser.js` / `trint-html-parser.js` (briefly — error throws look reasonable)
- Workshop's `runZap` and `extractSoundbites` paths
- The `api/gemini.js` Edge function

---

## Architecture quick-reference

- `translation/src/main.js` (~4870 lines) — orchestrator. Holds all global state (`segments`, `editorState`, `speakerMap`, `currentTranscriptId`, etc.) and wires up everything. Save logic, upload flow, view switching, realtime, lock management.
- `translation/src/db.js` — Supabase client + all DB queries. Includes TUS resumable upload (`uploadViaTus`), `releaseLockBeacon`, schema probing.
- `translation/src/snapshot.js` — localStorage snapshot vault for crash recovery. Indexed snapshots keyed by transcriptId + a draft snapshot keyed under a fixed `mcm_draft_snapshot` for the pre-id window.
- `translation/src/upload/media-flow.js` — `uploadMedia` → `runTranscription` two-step.
- `translation/src/upload/dialogs.js` — `openPreTranscribeDialog` (language + hints) and `openSpeakerLabelDialog` (per-speaker rename + ignore + sample audio).
- `translation/src/edit/media-deck.js` — pinned video + wavesurfer waveform, drag-to-move, click-to-seek into editor, J/K/L shortcuts, codec fallback.
- `translation/src/editor/Editor.jsx` — TipTap React wrapper. Speaker chips, summary panel, font cycler, sync menu, margin notes.
- `translation/src/editor/extensions/` — `Segment` (mark with timecode + originalText), `SpeakerBlock` (Node with click-to-rename + dismiss), `DeletedMark`, `HighlightMark`, `InterestPlugin`.
- `translation/src/editor/document-builder.js` — converts `segments[] + translations[]` into a TipTap doc. Handles bilingual.
- `translation/src/workshop/index.js` — Soundbite Workshop (theme bank → process → viewer; "zap" polishes).
- `translation/src/copilot/` — chat panel + auto-summary view.
- `translation/src/api-client.js` — wrappers for `/api/claude` (translate, summary, hunter, etc).
- `api/transcribe.js` — Vercel Edge function, routes Whisper or Deepgram.
- `api/claude.js`, `api/gemini.js` — thin proxies, pipe streaming responses straight through.

### Key state-flow contracts

- `gatherState()` is the canonical save-payload shape. If a new field is added, three places need updating: `gatherState()`, `applySnapshotPayload()`, and `applyTranscriptToState()`. Forgetting any of them was the source of multiple bugs this session.
- `np-speaker-rename` CustomEvent on `window` is the single chokepoint for speaker renames. Both the body-click and chip-double-click paths dispatch it. Listener in main.js does the actual segment + speakerMap + hiddenSpeakers rewrite + editor rebuild + autosave.
- `markDirty()` triggers `snapshotDirtyState()` which mirrors current state to LS. After every state mutation that's user-meaningful, call `markDirty()` *before* `autoSave()` — not after.
- `mediaDeck.destroy()` is now ONLY called by `teardownEditingSession()`. View toggles hide via `display:none`. Don't reintroduce destroys elsewhere.

---

## Prompt for next steps

Paste this into a fresh Claude Code session in `/Users/johnnyharris/playground/mycoldmars` to pick up where this left off:

> I'm continuing a multi-round debug + hardening pass on the Newpress Interpreter at `translation/`. Read `INTERPRETER_DEBUG_REPORT.md` at the repo root for what's already been fixed and what's deferred. The architecture quick-reference and "key state-flow contracts" sections are load-bearing — read them before changing global state, save logic, or the speaker-rename path.
>
> The user is Johnny Harris — a documentary filmmaker. Single-user app. Bias is speed/autonomy/experimentation; ship without asking, commit + push directly to `main` (Vercel auto-deploys). Never blanket `git add -A` without scanning `git status --short` first (the repo had a literal `${HOME}` directory pollution problem).
>
> **Top priorities, in order:**
>
> 1. **Verify the pre-id draft snapshot recovery actually works.** Open the live app, drop a media file, force the first save to fail (devtools → throttling → offline), close the tab, reopen. The recovery prompt should appear. The current implementation uses `window.confirm()` which is ugly — if it works, replace with a proper Newpress-styled modal matching `promptSnapshotRestore` in main.js.
>
> 2. **Audit the pieces I never read** (list in the report's "Things I haven't audited at all" section). Spawn parallel `Explore` agents for `copilot/CopilotPanel.jsx`, `sot-hunter.js`, `command-palette.js`, and the `export/` files. Hunt for: stale closures, useEffect dep bugs, listener leaks, places that mutate global state without `markDirty()`, prompt-injection holes, and any Claude/Gemini calls that haven't been bumped to current model IDs.
>
> 3. **Tackle the deferred P0/P1s if they bite the user.** P1-7 (Editor.jsx JSON.stringify perf) only matters on big transcripts — wait for a real complaint. P3-15 (signed URL expiring mid-transcription) only matters on multi-GB uploads — same. Don't pre-optimize.
>
> 4. **The Premiere XML export hardcodes 24fps.** Most Newpress footage is 23.976. Either auto-detect from the source media's actual fps (stored in `media_uploads.metadata` or probable from wavesurfer) or surface a per-export picker. This is the highest-impact non-debug improvement.
>
> 5. **The bigger backlog** lives in `~/.claude/projects/-Users-johnnyharris/memory/project_newpress_interpreter.md`. Don't pivot to that without explicit direction.
>
> **Hard rules from this session:**
> - Always check `git status --short` before staging — repo has a history of stray-file pollution.
> - When fixing the same bug pattern in multiple places, search for *all* instances first (different indentation broke a `replace_all` once).
> - When auditors return a punch list, **verify each finding** before fixing — about 40% are hallucinations.
> - The Hunter sub-app is in the same monorepo. Its build breakage will silently fail the Vercel deploy for everything. If interpreter changes aren't appearing, check `bun run build` from the repo root.
> - `--np-space-5` does not exist in the CSS token scale. Use `--np-space-4` or `--np-space-6`.
> - `seg.text` (not `seg.original`) is the canonical text field across the codebase. The transcribe API returns `original`; media-flow.js normalizes it to `text`.
> - Forge auto-include is required at E3+. If `codex` CLI isn't installed locally, Forge runs as Claude Opus instead — useful as fresh eyes but not actually GPT-5.4.

---

*End of report. Last commit at time of writing: `d5516b4`.*
