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

  // First pass: group segments into runs of "real" and "unintelligible"
  const groups = [];
  let i = 0;

  while (i < translations.length) {
    const t = translations[i];
    const seg = segments[i];
    if (!seg) { i++; continue; }

    if (t.unintelligible) {
      // Start an unintelligible run — bundle consecutive ones
      const runStart = i;
      while (i < translations.length && translations[i].unintelligible) {
        i++;
      }
      const runEnd = i - 1;
      groups.push({
        type: 'unintelligible',
        startSec: timeToSeconds(segments[runStart].start),
        endSec: timeToSeconds(segments[runEnd].end),
      });
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

  return subtitles
    .map(s => `${s.index}\n${s.start} --> ${s.end}\n${s.text}\n`)
    .join('\n');
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
      const breakIdx = findBreakPoint(words, i, targetLen, { sentenceEnd, clauseBreak, conjunctions, prepositions });
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

function findBreakPoint(words, currentIdx, targetLen, patterns) {
  const searchRange = Math.min(4, words.length - currentIdx - 1);

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

/** Format seconds to SRT timecode: HH:MM:SS,mmm */
function formatSRT(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }
