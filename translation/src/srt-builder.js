/**
 * Build SRT content from translated segments + original timing.
 * Consecutive unintelligible segments are bundled into single [unintelligible] ranges.
 *
 * @param {Array} translations — [{ number, original, translated, language, kept_original, unintelligible }]
 * @param {Array} segments     — original parsed segments with start/end times
 * @param {object} opts        — { maxWords: 16, maxDuration: 5 }
 * @returns {string} SRT file content
 */
export function buildSRT(translations, segments, opts = {}) {
  const maxWords = opts.maxWords || 16;
  const maxDuration = opts.maxDuration || 5;
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
    const text = t.translated || t.original;
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
      const proportion = chunks[j].length / totalChars;
      let chunkDur = duration * proportion;
      // Hard cap each chunk at maxDuration. Without this, if splitText
      // returned fewer chunks than asked for, a single chunk could end up
      // spanning the full segment — blowing past the slider's max.
      chunkDur = Math.min(chunkDur, maxDuration);
      chunkDur = Math.max(chunkDur, 1);
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

/** Parse various timecode formats to seconds */
function timeToSeconds(tc) {
  if (!tc) return 0;

  const match = tc.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (match) {
    const [, h, m, s, ms] = match;
    const msNorm = ms.padEnd(3, '0').slice(0, 3);
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(msNorm) / 1000;
  }

  const match2 = tc.match(/(\d+):(\d+)[.,](\d+)/);
  if (match2) {
    const [, m, s, ms] = match2;
    const msNorm = ms.padEnd(3, '0').slice(0, 3);
    return parseInt(m) * 60 + parseInt(s) + parseInt(msNorm) / 1000;
  }

  const match3 = tc.match(/(\d+):(\d+)$/);
  if (match3) {
    return parseInt(match3[1]) * 60 + parseInt(match3[2]);
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
function formatSRT(sec) {
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
