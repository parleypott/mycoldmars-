// ffprobe metadata helpers — used by the transcode worker to capture the
// source video's real frame rate (and dimensions) so the Premiere XML export
// can label the sequence with the true source fps instead of a hardcoded
// guess. Kept in its own module (no top-level side effects) so the pure
// parse logic is unit-testable without spinning up the worker's Supabase
// client / poll loop.
//
// Why this matters: ffprobe reports NTSC rates as exact rationals —
// 23.976 footage is "24000/1001" (= 23.97602…), 29.97 is "30000/1001". The
// Premiere XML builders' tolerance-based isNtscRate() handles those values
// correctly (see translation/src/export/premiere-xml.js), so persisting the
// raw probed float is safe and accurate.

import { spawn } from 'node:child_process';

export interface VideoMeta {
  fps: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Parse an ffprobe rational frame-rate string ("24000/1001", "30/1", "25/1")
 * — or a plain numeric string — into a float. Returns null for missing,
 * zero, or unparseable values so callers degrade gracefully (a missing fps
 * just means the export falls back to its default rate).
 */
export function parseFrameRate(str: string | null | undefined): number | null {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed) return null;

  const rational = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (rational) {
    const num = Number(rational[1]);
    const den = Number(rational[2]);
    if (!num || !den) return null; // "0/0" or "0/1" → no usable rate
    return num / den;
  }

  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Probe a media file's first video stream via ffprobe. Returns null on ANY
 * failure (ffprobe missing, audio-only file, non-zero exit, malformed JSON)
 * so the caller can treat metadata as best-effort and never block on it.
 */
export function probeVideoMeta(inputPath: string): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate,avg_frame_rate,width,height',
      '-of', 'json',
      inputPath,
    ];

    let proc;
    try {
      proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) { resolve(null); return; }
      resolve(parseProbeJson(stdout));
    });
  });
}

/**
 * Parse ffprobe's `-of json` output into a VideoMeta. Pure (no I/O) so it's
 * unit-testable against captured ffprobe payloads. Prefers r_frame_rate
 * (the stream's nominal rate) and falls back to avg_frame_rate.
 */
export function parseProbeJson(stdout: string): VideoMeta | null {
  let json;
  try { json = JSON.parse(stdout); } catch { return null; }
  const stream = json?.streams?.[0];
  if (!stream) return null;

  const fps = parseFrameRate(stream.r_frame_rate) ?? parseFrameRate(stream.avg_frame_rate);
  const width = Number.isFinite(+stream.width) ? +stream.width : null;
  const height = Number.isFinite(+stream.height) ? +stream.height : null;

  return { fps, width, height };
}
