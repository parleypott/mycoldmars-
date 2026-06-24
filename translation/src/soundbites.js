// Pure soundbite-import + Sacred-Selects-sequence core for the Interpreter.
//
// Extracted from main.js so the producer-facing manual-paste import path can be
// unit-tested headlessly. This is the front door for the SOT/soundbite sequence
// Johnny pastes selects into — a regression in any of the four format regexes or
// the sequence-detection logic would silently drop or misparse pasted soundbites
// with no signal, so the parsing contract is locked by soundbites.test.mjs.
//
// crypto.randomUUID is a global in both the browser and the Node/bun test runtime.

import { formatClock } from './format-clock.js';

/**
 * Parse soundbites from pasted text. Tolerates several common formats:
 *
 *   F1 (canonical):
 *     [SEQUENCE | 00:00:01 → 00:00:05] text...
 *
 *   F2 (transcription service, in/out + duration at end):
 *     SEQUENCE - SPEAKER: [00:00:01] text... [00:00:05][4.0]
 *     SEQUENCE: [00:00:01] text... [00:00:05][4.0]
 *
 *   F3 (single-timecode, no end — uncuttable, flagged):
 *     SEQUENCE - SPEAKER: [00:00:01] text...
 *
 *   F4 (filename + Speaker N (TC), no end — uncuttable, flagged):
 *     260316-04-102-FISHERMAN.mp4
 *     FISHERMAN Speaker 6 (00:58:58.16) text...
 *
 * Returns { bites, skipped } — bites are cuttable; skipped is a list of
 * { raw, reason } for lines we recognized but couldn't extract an end TC from.
 */
export function parseSoundbites(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const bites = [];
  const skipped = [];

  // F1
  const f1 = /^\[([^|]+?)\s*\|\s*([0-9:.,]+)\s*→\s*([0-9:.,]+)\]\s*(.+)/;
  // F2: prefix: [start] text [end][duration?]
  //   prefix can be "260304-0439-Chihhao Yu" or "01 MIKAEL ANTELL" or "Mars Study - JOHNNY"
  const f2 = /^(.+?):\s*\[([0-9:.,]+)\]\s*(.+?)\s*\[([0-9:.,]+)\](?:\[[0-9.]+\])?\s*$/;
  // F3: prefix: [start] text   (no end timecode at all)
  const f3 = /^(.+?):\s*\[([0-9:.,]+)\]\s*(.+)$/;
  // F4 header: "<sequence>.mp4"
  const f4Header = /^(.+?\.mp4)$/i;
  // F4 body: "SPEAKER Speaker N (TC)"
  const f4Body = /^.+?\s+Speaker\s+\d+\s+\(([0-9:.,]+)\)/i;

  // Track context for F4 (the .mp4 line precedes the speaker line).
  let f4Prefix = null;

  for (const line of lines) {
    // F1
    let m = line.match(f1);
    if (m) {
      bites.push({
        id: crypto.randomUUID(),
        prefix: m[1].trim(),
        start: m[2].trim(),
        end: m[3].trim(),
        text: m[4].trim(),
      });
      f4Prefix = null;
      continue;
    }

    // F2
    m = line.match(f2);
    if (m) {
      bites.push({
        id: crypto.randomUUID(),
        prefix: m[1].trim(),
        start: m[2].trim(),
        end: m[4].trim(),
        text: m[3].trim(),
      });
      f4Prefix = null;
      continue;
    }

    // F4 — filename header, remember it for the next line
    m = line.match(f4Header);
    if (m) {
      f4Prefix = m[1].replace(/\.mp4$/i, '').trim();
      continue;
    }

    // F4 body
    m = line.match(f4Body);
    if (m && f4Prefix) {
      skipped.push({ raw: line, reason: 'no end timecode — only a single timestamp', prefix: f4Prefix });
      f4Prefix = null;
      continue;
    }

    // F3 — single TC, no end
    m = line.match(f3);
    if (m) {
      skipped.push({ raw: line, reason: 'no end timecode — only a single timestamp', prefix: m[1].trim() });
      f4Prefix = null;
      continue;
    }

    // Unrecognized — silent skip
    f4Prefix = null;
  }

  return { bites, skipped };
}

export function extractSacredName(prefix) {
  // Strip "- SPEAKER" suffix: "Mars Study - JOHN" → "Mars Study"
  return prefix.replace(/\s*-\s*[A-Z][A-Z0-9 ]*$/i, '').trim() || prefix;
}

export function detectSacredSequence(bites) {
  // Count sequence names by frequency — the most common one is the sacred sequence
  const counts = {};
  for (const b of bites) {
    const name = extractSacredName(b.prefix);
    counts[name] = (counts[name] || 0) + 1;
  }
  let best = '', bestCount = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > bestCount) { best = name; bestCount = count; }
  }
  return { name: best, count: bestCount, total: bites.length };
}

export function detectAllSequences(bites) {
  const map = {};
  for (const b of bites) {
    const name = extractSacredName(b.prefix);
    if (!map[name]) map[name] = { name, count: 0 };
    map[name].count++;
  }
  return Object.values(map).sort((a, b) => b.count - a.count);
}

export function formatDuration(bites) {
  let totalSec = 0;
  // Each field coerces to a FINITE number — the soundbite regex (`[0-9:.,]+`)
  // accepts pure-punctuation timecodes (":", "::"), so an empty hh/mm field
  // would yield NaN. A single NaN here used to poison the whole running total
  // (NaN + anything = NaN), collapsing a real multi-minute sequence to "0:00".
  // Isolate it per-bite: a malformed bite contributes 0, not poison.
  const num = (x) => { const v = parseFloat(x); return Number.isFinite(v) ? v : 0; };
  const parts = (tc) => {
    const p = String(tc ?? '').replace(',', '.').split(':');
    if (p.length === 3) return num(p[0]) * 3600 + num(p[1]) * 60 + num(p[2]);
    if (p.length === 2) return num(p[0]) * 60 + num(p[1]);
    return num(p[0]);
  };
  for (const b of bites) {
    const dur = parts(b.end) - parts(b.start);
    totalSec += dur > 0 ? dur : 0;
  }
  // Hour-carrying clock format (shared) — a long soundbite sequence can total
  // over an hour, which the old inline `${m}:${s}` dropped to e.g. "90:00".
  return formatClock(totalSec);
}

export function tcToFrameNotation(tc, fps) {
  // Mirror formatDuration's parts() guard: a persisted/edited soundbite whose
  // start/end arrives as a number, null, or undefined would otherwise throw
  // "tc.replace is not a function" here and crash the WHOLE sequence-block
  // render (this runs per block, not just for the total). Coerce defensively —
  // a nullish/garbage tc renders as frame 0, never a throw. Byte-identical for
  // every well-formed string timecode.
  const parts = String(tc ?? '').replace(',', '.').split(':');
  let h = 0, m = 0, secStr = '0';
  if (parts.length === 3) { h = parseInt(parts[0]) || 0; m = parseInt(parts[1]) || 0; secStr = parts[2]; }
  else if (parts.length === 2) { m = parseInt(parts[0]) || 0; secStr = parts[1]; }
  else { secStr = parts[0]; }

  const dotIdx = secStr.indexOf('.');
  const s = parseInt(dotIdx >= 0 ? secStr.slice(0, dotIdx) : secStr) || 0;
  const frac = dotIdx >= 0 ? parseFloat('0' + secStr.slice(dotIdx)) : 0;
  const frames = Math.floor(frac * fps);
  const ff = frames.toString().padStart(2, '0');

  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${ff}`;
  return `${m}:${s.toString().padStart(2, '0')}:${ff}`;
}
