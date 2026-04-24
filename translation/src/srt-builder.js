/**
 * Build SRT content from translated segments + original timing.
 *
 * @param {Array} translations — [{ number, original, translated, language, kept_original }]
 * @param {Array} segments     — original parsed segments with start/end times
 * @param {object} opts        — { maxWords: 16, maxDuration: 5 }
 * @returns {string} SRT file content
 */
export function buildSRT(translations, segments, opts = {}) {
  const maxWords = opts.maxWords || 16;
  const maxDuration = opts.maxDuration || 5;

  const subtitles = [];
  let counter = 1;

  for (let i = 0; i < translations.length; i++) {
    const t = translations[i];
    const seg = segments[i];
    if (!seg) continue;

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
      chunkDur = Math.max(chunkDur, 1); // minimum 1 second
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
  if (words.length <= n) return words.map(w => w); // one word per chunk

  const targetLen = Math.ceil(words.length / n);
  const chunks = [];
  let current = [];

  // Priority break patterns
  const sentenceEnd = /[.!?]$/;
  const clauseBreak = /[,;:\u2014]$/;
  const conjunctions = new Set(['and', 'but', 'so', 'because', 'then', 'or', 'yet', 'while', 'when', 'after', 'before']);
  const prepositions = new Set(['in', 'at', 'on', 'for', 'with', 'to', 'from', 'by', 'of', 'about']);

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);

    if (chunks.length < n - 1 && current.length >= targetLen) {
      // Try to find a good break point near here
      const breakIdx = findBreakPoint(words, i, targetLen, { sentenceEnd, clauseBreak, conjunctions, prepositions });
      if (breakIdx > i) {
        // Add words up to the break
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
  // Look ahead up to 4 words for a natural break
  const searchRange = Math.min(4, words.length - currentIdx - 1);

  for (let offset = 0; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    const word = words[idx];

    if (patterns.sentenceEnd.test(word)) return idx;
  }

  for (let offset = 0; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    const word = words[idx];

    if (patterns.clauseBreak.test(word)) return idx;
  }

  for (let offset = 1; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    const word = words[idx]?.toLowerCase();

    if (patterns.conjunctions.has(word)) return idx - 1;
  }

  for (let offset = 1; offset <= searchRange; offset++) {
    const idx = currentIdx + offset;
    const word = words[idx]?.toLowerCase();

    if (patterns.prepositions.has(word)) return idx - 1;
  }

  return currentIdx;
}

/** Parse various timecode formats to seconds */
function timeToSeconds(tc) {
  if (!tc) return 0;

  // HH:MM:SS.mmm or HH:MM:SS,mmm
  const match = tc.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
  if (match) {
    const [, h, m, s, ms] = match;
    const msNorm = ms.padEnd(3, '0').slice(0, 3);
    return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(msNorm) / 1000;
  }

  // MM:SS.mmm
  const match2 = tc.match(/(\d+):(\d+)[.,](\d+)/);
  if (match2) {
    const [, m, s, ms] = match2;
    const msNorm = ms.padEnd(3, '0').slice(0, 3);
    return parseInt(m) * 60 + parseInt(s) + parseInt(msNorm) / 1000;
  }

  // MM:SS
  const match3 = tc.match(/(\d+):(\d+)$/);
  if (match3) {
    return parseInt(match3[1]) * 60 + parseInt(match3[2]);
  }

  // Seconds as float
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
