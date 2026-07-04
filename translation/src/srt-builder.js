/**
 * Build SRT content from translated segments + original timing.
 * Consecutive unintelligible segments are bundled into single [unintelligible] ranges.
 *
 * @param {Array} translations — [{ number, original, translated, language, kept_original, unintelligible }]
 * @param {Array} segments     — original parsed segments with start/end times
 * @param {object} opts        — { maxWords: 16, maxDuration: 5 }
 * @returns {string} SRT file content
 */
// Normalize an SRT chunking limit to a POSITIVE finite number, falling back to
// `d` for anything invalid. The old `opts.maxWords || 16` form looked safe but
// only caught undefined/NaN/0 — a NEGATIVE value is truthy, so `-5` sailed
// through and made `Math.ceil(words.length / -5)` a negative chunk count
// (malformed/empty SRT). Unreachable from today's min=10/min=3 range sliders,
// but the core must not trust its callers: any future number-input markup or new
// caller passing 0/negative/NaN/"" now degrades to the sane default instead.
function posLimit(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function buildSRT(translations, segments, opts = {}) {
  const maxWords = posLimit(opts.maxWords, 16);
  const maxDuration = posLimit(opts.maxDuration, 5);
  const dismissedSegments = opts.dismissedSegments || null;
  const hideUnintelligible = opts.hideUnintelligible || false;

  // First pass: group segments into runs of "real", "unintelligible", and "chatter"
  const groups = [];
  let i = 0;

  while (i < translations.length) {
    const t = translations[i];
    const seg = segments[i];
    if (!seg) { i++; continue; }

    const isDismissed = dismissedSegments && dismissedSegments.has(seg.number);

    if (isDismissed) {
      // Start a chatter run — bundle consecutive dismissed
      const runStart = i;
      while (i < translations.length && segments[i] && dismissedSegments.has(segments[i].number)) {
        i++;
      }
      const runEnd = i - 1;
      groups.push({
        type: 'chatter',
        startSec: timeToSeconds(segments[runStart].start),
        endSec: timeToSeconds(segments[runEnd].end),
      });
    } else if (t.unintelligible) {
      // Start an unintelligible run — bundle consecutive ones
      const runStart = i;
      while (i < translations.length && translations[i].unintelligible && !(dismissedSegments && segments[i] && dismissedSegments.has(segments[i].number))) {
        i++;
      }
      if (hideUnintelligible) {
        // Skip entirely — no subtitle entry
      } else {
        const runEnd = i - 1;
        groups.push({
          type: 'unintelligible',
          startSec: timeToSeconds(segments[runStart].start),
          endSec: timeToSeconds(segments[runEnd].end),
        });
      }
    } else {
      groups.push({
        type: 'real',
        translation: t,
        segment: seg,
      });
      i++;
    }
  }

  // Second pass: build subtitles
  const subtitles = [];
  let counter = 1;

  for (const group of groups) {
    if (group.type === 'chatter') {
      subtitles.push({
        index: counter++,
        start: formatSRT(group.startSec),
        end: formatSRT(group.endSec),
        text: '[chatter]',
      });
      continue;
    }

    if (group.type === 'unintelligible') {
      subtitles.push({
        index: counter++,
        start: formatSRT(group.startSec),
        end: formatSRT(group.endSec),
        text: '[unintelligible]',
      });
      continue;
    }

    const { translation: t, segment: seg } = group;
    // `|| ''` so a group with NEITHER a translated NOR an original string
    // (both missing/empty — a blank segment) yields '' instead of `undefined`,
    // whose `.split` would throw and CRASH the whole export. The blank text then
    // flows through the totalChars===0 equal-share fallback below.
    const text = (t.translated || t.original) || '';
    const startSec = timeToSeconds(seg.start);
    const endSec = timeToSeconds(seg.end);
    const duration = endSec - startSec;
    const words = text.split(/\s+/).filter(Boolean);

    if (words.length <= maxWords && duration <= maxDuration) {
      subtitles.push({
        index: counter++,
        start: formatSRT(startSec),
        end: formatSRT(endSec),
        text,
      });
      continue;
    }

    // Need to chunk
    const numChunks = Math.max(
      Math.ceil(words.length / maxWords),
      Math.ceil(duration / maxDuration)
    );

    const chunks = splitText(text, numChunks);
    const totalChars = chunks.reduce((s, c) => s + c.length, 0);

    let cursor = startSec;
    for (let j = 0; j < chunks.length; j++) {
      // Proportion of the segment's duration this chunk gets, by its share of
      // the text. When every chunk is empty (a blank/whitespace-only segment
      // that still exceeds maxDuration — real in this pipeline: blank-text
      // segments ship from bilingual-JSON underflow, and t.translated can come
      // back empty), totalChars is 0 and `len/0` is NaN — which cascades to a
      // NaN cursor and floors every remaining cue to 00:00:00,000, injecting
      // non-monotonic zero-duration cues that strict SRT parsers reject. Fall
      // back to an EQUAL share so the (empty) cues still tile the segment's real
      // time monotonically. Byte-identical for every real (totalChars>0) input.
      const proportion = totalChars > 0
        ? chunks[j].length / totalChars
        : 1 / chunks.length;
      let chunkDur = duration * proportion;
      // Hard cap each chunk at maxDuration. Without this, if splitText
      // returned fewer chunks than asked for, a single chunk could end up
      // spanning the full segment — blowing past the slider's max.
      chunkDur = Math.min(chunkDur, maxDuration);
      // Floor each cue to at least 1s WHEN the segment has room, but never
      // demand more than an equal share of the time left. A fixed 1s floor
      // overshoots endSec once numChunks exceeds the segment's whole-second
      // capacity (common with a short maxWords — e.g. one-line captions:
      // maxWords=4 on a 20-word / 3s line forces 5 chunks into 3 seconds).
      // The old floor then pushed cursor past endSec, and the Math.min clamp
      // below pinned every trailing cue to endSec → zero-duration cues
      // (start==end), which SRT players drop, silently losing those words.
      // Capping the floor at the fair share (remaining ÷ remaining chunks)
      // keeps every cue strictly positive and inside the segment. Identical
      // to the old `Math.max(chunkDur, 1)` whenever there's ≥1s per remaining
      // chunk — i.e. every non-squeezed case.
      const remainingChunks = chunks.length - j;
      const fairShare = remainingChunks > 0 ? (endSec - cursor) / remainingChunks : 0;
      chunkDur = Math.max(chunkDur, Math.min(1, fairShare));
      const chunkEnd = Math.min(cursor + chunkDur, endSec);

      subtitles.push({
        index: counter++,
        start: formatSRT(cursor),
        end: formatSRT(chunkEnd),
        text: chunks[j],
      });

      cursor = chunkEnd;
    }
  }

  // CRLF line endings — Premiere and many older SRT consumers require
  // \r\n between cue lines and a blank \r\n between cues. Using bare
  // \n breaks import on Windows-targeted workflows.
  return subtitles
    .map(s => `${s.index}\r\n${s.start} --> ${s.end}\r\n${s.text}\r\n`)
    .join('\r\n');
}

/**
 * Split text into `n` chunks at natural break points.
 */
function splitText(text, n) {
  if (n <= 1) return [text];

  const words = text.split(/\s+/);
  if (words.length <= n) return words.map(w => w);

  const targetLen = Math.ceil(words.length / n);
  const chunks = [];
  let current = [];

  const sentenceEnd = /[.!?]$/;
  const clauseBreak = /[,;:\u2014]$/;
  const conjunctions = new Set(['and', 'but', 'so', 'because', 'then', 'or', 'yet', 'while', 'when', 'after', 'before']);
  const prepositions = new Set(['in', 'at', 'on', 'for', 'with', 'to', 'from', 'by', 'of', 'about']);

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);

    if (chunks.length < n - 1 && current.length >= targetLen) {
      // Don't let the break-point search jump so far ahead that it eats
      // all the remaining words and starves the next chunks. Cap the
      // look-ahead to roughly half of targetLen.
      const lookahead = Math.max(1, Math.min(4, Math.ceil(targetLen / 2)));
      const breakIdx = findBreakPoint(words, i, targetLen, lookahead, { sentenceEnd, clauseBreak, conjunctions, prepositions });
      if (breakIdx > i) {
        for (let j = i + 1; j <= breakIdx && j < words.length; j++) {
          current.push(words[j]);
          i = j;
        }
      }
      chunks.push(current.join(' '));
      current = [];
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(' '));
  }

  return chunks;
}

function findBreakPoint(words, currentIdx, targetLen, lookahead, patterns) {
  const searchRange = Math.min(lookahead, words.length - currentIdx - 1);

  for (let offset = 0; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    if (patterns.sentenceEnd.test(words[idx])) return idx;
  }
  for (let offset = 0; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    if (patterns.clauseBreak.test(words[idx])) return idx;
  }
  for (let offset = 1; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    if (patterns.conjunctions.has(words[idx]?.toLowerCase())) return idx - 1;
  }
  for (let offset = 1; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    if (patterns.prepositions.has(words[idx]?.toLowerCase())) return idx - 1;
  }

  return currentIdx;
}

/** Parse various timecode formats to seconds.
 *
 * Patterns are ANCHORED (^…$) and the fractional part is OPTIONAL. The
 * previous version required a fraction for the colon-separated forms, so a
 * fraction-less HH:MM:SS (the common Happy Scribe / Trint export shape) fell
 * through to an UN-anchored MM:SS matcher that latched onto the trailing
 * "MM:SS" — silently dropping the hours. "01:02:03" parsed as 00:02:03,
 * shifting every cue past the first hour back by a full hour. Anchoring +
 * optional fraction makes each form match exactly one shape.
 */
export function timeToSeconds(tc) {
  if (!tc) return 0;
  tc = String(tc).trim();
  const msFrac = (ms) => ms ? parseInt(ms.padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;

  // HH:MM:SS(.mmm) — single- or multi-digit hours, optional fraction
  const m3 = tc.match(/^(\d+):(\d+):(\d+)(?:[.,](\d+))?$/);
  if (m3) {
    const [, h, m, s, ms] = m3;
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + msFrac(ms);
  }

  // MM:SS(.mmm)
  const m2 = tc.match(/^(\d+):(\d+)(?:[.,](\d+))?$/);
  if (m2) {
    const [, m, s, ms] = m2;
    return parseInt(m, 10) * 60 + parseInt(s, 10) + msFrac(ms);
  }

  const f = parseFloat(tc);
  return isNaN(f) ? 0 : f;
}

/** Format seconds to SRT timecode: HH:MM:SS,mmm
 *
 * Two carry-overflow cases the previous implementation missed:
 *   • ms rounds to 1000 (e.g. sec=0.9995) → carry into seconds.
 *   • HH ≥ 100 → SRT spec is 2-digit hours; Premiere rejects 100:MM:SS.
 *     For a transcript that long we cap at 99:59:59,999 — the file is
 *     way past usable territory anyway, but a malformed cue is worse.
 */
export function formatSRT(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  let totalMs = Math.round(sec * 1000);
  // 99:59:59,999 cap so the timecode always fits HH:MM:SS,mmm
  const MAX_MS = (99 * 3600 + 59 * 60 + 59) * 1000 + 999;
  if (totalMs > MAX_MS) totalMs = MAX_MS;
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }
