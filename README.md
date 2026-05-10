# mycoldmars

Newpress's first-party software repo. Multiple sibling apps live under one Vercel project + one Supabase backend.

```
.
├── api/                       Vercel Edge Functions (proxies + access gate)
│   ├── access.js              Shared-secret auth gate (issues + verifies)
│   ├── transcribe.js          Deepgram + Whisper router (audio → text)
│   ├── claude.js              Anthropic proxy (key never leaves server)
│   └── gemini.js              Google Gemini proxy + Hunter helpers
│
├── translation/               Newpress Interpreter — Trint-replacement editor
│   ├── index.html             SPA shell + access-code gate
│   ├── src/
│   │   ├── main.js            Orchestrator (~6.5k lines; needs splitting)
│   │   ├── db.js              Supabase client + every query
│   │   ├── snapshot.js        localStorage crash-recovery vault
│   │   ├── upload/            Upload + transcribe pipeline
│   │   ├── edit/media-deck.js Pinned video + waveform deck
│   │   ├── editor/            TipTap (Prosemirror) wrapper + extensions
│   │   ├── workshop/          Soundbite Workshop (theme detection)
│   │   ├── copilot/           Per-passage AI chat panel
│   │   ├── export/            SRT / Premiere XML / FCP XML / PDF
│   │   ├── csv-parser.js      Trint / generic CSV ingest
│   │   ├── json-parser.js     Happy Scribe word-level ingest
│   │   ├── trint-html-parser.js Trint Interactive HTML ingest
│   │   ├── sot-hunter.js      Paste-a-soundbite-reference matcher
│   │   └── sequencer/         Sacred Sequencer (FCP XML output)
│   └── style.css              Single CSS file (~6k lines; brand mono)
│
├── hunter/                    The Hunter — sister video-analysis tool
│
├── tools/
│   ├── transcode-worker.ts    Bun script that polls Supabase for ProRes
│   │                          uploads and ffmpeg-transcodes them to H.264
│   └── README-transcode-worker.md
│
├── supabase-*.sql             Schema migrations (apply in numerical order)
└── INTERPRETER_DEBUG_REPORT.md Snapshot of architectural decisions + audit
```

## Quick start

```bash
bun install
cp .env.example .env.local        # then fill in (see SECURITY.md)
bun run dev                       # Vite + Vercel functions locally
```

To deploy: push to `main`. Vercel auto-builds + deploys.

To enable transcoding of Premiere ProRes proxies, run the worker on a Mac with ffmpeg installed:

```bash
brew install ffmpeg
set -a; source .env.local; set +a
bun tools/transcode-worker.ts
```

(Optional launchd plist for daemon mode in `tools/README-transcode-worker.md`.)

## Architecture at a glance

- **Frontend**: Vite + Preact + TipTap. Vanilla JS (not TypeScript) — single-developer codebase, prioritized iteration speed.
- **Backend**: Vercel Edge Functions for proxies and access gate. No persistent server.
- **Database**: Supabase Postgres. Schema in `supabase-*.sql` migrations.
- **Storage**: Supabase Storage with TUS resumable upload (>6 MB).
- **Transcription**: Deepgram Nova-3 (preferred, 2 GB cap, diarization). Whisper API fallback (25 MB cap).
- **AI**: Claude Sonnet 4.6 for translation/summary/copilot. Gemini 2.5 Flash for Hunter scene insights.
- **Auth**: Single shared-secret access code (`ACCESS_CODE` env var). No real users — see `SECURITY.md` for posture + path to multi-user.
- **Realtime**: Supabase Realtime channels for cross-tab transcript sync + presence.
- **Crash recovery**: Every save mirrors to localStorage (`mcm_snap_{id}`) with a draft snapshot for the pre-id window. On reload, newer-than-server snapshots prompt the user to restore.

## Posture

This app is **single-user** by design: one filmmaker (Johnny Harris) editing his own work. The shared-secret gate is intentional, RLS is permissive on purpose, and everything is built to optimize for solo workflow speed. See `SECURITY.md` for what changes if/when it goes multi-tenant.

## Where to start reading

- New to the codebase? Open `INTERPRETER_DEBUG_REPORT.md` for a high-level map + recent architectural decisions.
- Reviewing the database? `supabase-phase1.sql` first (core schema), then `phase2`/`phase3`/`presence`/`transcode` for the layered additions, then `db.js` for the query surface.
- Reviewing the upload pipeline? `translation/src/upload/media-flow.js` (single-file path) and the `uploadQueue` block in `main.js` (bulk path).
- Reviewing the editor? `translation/src/editor/Editor.jsx` (React wrapper) and `translation/src/editor/extensions/` (TipTap nodes/marks).

## Status

In active development. Single-tenant, single-developer. Many features ship daily; see `git log` for recent context.
