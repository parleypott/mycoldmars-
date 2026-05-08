# Transcode worker

Server-side ProRes/MOV/MXF → H.264 MP4 transcoder. Runs on the workhorse Mac, polls Supabase, and produces browser-playable previews so the Interpreter's media deck can actually play your Premiere proxies.

## One-time setup

1. **Apply the schema migration.** The repo root has `supabase-transcode.sql`. Easiest: open the Supabase SQL editor → paste → run. Or via `psql` if your network can reach the DB directly:
   ```
   psql "$SUPABASE_DB_URL" -f supabase-transcode.sql
   ```

2. **Install ffmpeg if it's not already on the Mac:**
   ```
   brew install ffmpeg
   ```

3. **Make sure env vars are set.** The worker reads from the shell — same `.env.local` the rest of the app uses works fine if you `set -a; source .env.local; set +a` first. Required:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY` (NOT the anon key)

## Running

```
cd ~/playground/mycoldmars
set -a; source .env.local; set +a
bun tools/transcode-worker.ts
```

Polls every 10s. One job at a time. Writes progress to stdout. Ctrl-C to stop.

## What happens end-to-end

1. You drop a `.mov` (Premiere proxy) into the Interpreter.
2. Upload completes → `media_uploads` row inserted with `transcode_status = 'pending'`.
3. The worker (running on the Mac) sees the pending row, claims it atomically, downloads the file from Supabase Storage, runs `ffmpeg -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart`, uploads the result to `transcodes/<original-stamp>-<safe-name>.mp4`, updates the row with `transcode_path` + `transcode_status = 'done'`.
4. The editor was already polling the row — when it sees `done`, it re-mounts the media deck against the new H.264 URL. Playback works.

While the worker is processing, the deck shows a "transcoding" banner instead of the misleading "no preview" one. Transcript editing isn't blocked.

## Run it as a launchd daemon (optional)

So it survives reboots and runs in the background:

Create `~/Library/LaunchAgents/com.newpress.transcode-worker.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.newpress.transcode-worker</string>
  <key>WorkingDirectory</key><string>/Users/johnnyharris/playground/mycoldmars</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>set -a; source .env.local; set +a; exec /Users/johnnyharris/.bun/bin/bun tools/transcode-worker.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/transcode-worker.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/transcode-worker.err.log</string>
</dict>
</plist>
```

Then:

```
launchctl load ~/Library/LaunchAgents/com.newpress.transcode-worker.plist
```

To stop: `launchctl unload ~/Library/LaunchAgents/com.newpress.transcode-worker.plist`.

## Knobs

Inside `tools/transcode-worker.ts`:

- `POLL_INTERVAL_MS = 10_000` — how often to check for new jobs.
- ffmpeg args — currently 1280px max width, CRF 23 (visually lossless-ish), AAC 128k. Bump CRF down for higher quality, up for smaller files.

## Failure modes

- **`ffmpeg: command not found`** — install via `brew install ffmpeg`.
- **`SUPABASE_URL / SUPABASE_SERVICE_KEY missing`** — source `.env.local` first.
- **Job stuck in 'processing'** — worker died mid-job. Manually flip the row back to `'pending'` in Supabase SQL editor:
  ```sql
  UPDATE media_uploads SET transcode_status = 'pending' WHERE id = '...';
  ```
- **All jobs failing with the same error** — check `transcode_error` column on the row for the ffmpeg/network message.
