// Interpreter — ONE shared recognizer for the model's segment-reference syntax.
//
// The auto-summary model is told to "include the approximate segment numbers" but
// is NOT given a strict format, so it cites segments many ways: (Segments 3-7),
// (Segment 3), [3-7], [3]. Two consumers act on those refs:
//   • enrichSummaryWithTimecodes (main.js) — REPLACES each ref with its real
//     timecode for display, so Johnny reads "(0:45 – 2:10)" not "(Segments 3-7)".
//   • parseSummaryBullets (summary-bullets.js) — EXTRACTS the segment numbers so a
//     summary bullet can jump to that span of transcript.
//
// Both used to carry their OWN copy of the regex (4 copies total: 2 in main.js,
// 2 here) and every copy only accepted a hyphen or en-dash as the range separator.
// But Claude routinely writes prose ranges with an EM-DASH ("(Segments 3—7)") or
// the word "to"/"through" — and those leaked through completely: the enricher left
// the raw "(Segments 3—7)" in the summary, and the bullet mis-linked to the wrong
// span. This module is the single source of truth for the pattern AND widens the
// separator set to what the model actually emits. It only ever recognizes MORE
// refs than before — a ref that resolved before still resolves identically.

// Range separators the model actually uses: ASCII hyphen, en-dash, em-dash, or the
// words "to"/"through". Surrounding whitespace optional so "3-7" and "3 to 7" match.
const SEP = '(?:\\s*(?:[-\\u2013\\u2014]|to|through)\\s*)';

// Capture groups: 1=paren start, 2=paren end, 3=bracket start, 4=bracket end.
// The end group is optional so a single-segment ref (Segment 3) / [3] still matches.
const CORE = `\\(Segments?\\s+(\\d+)(?:${SEP}(\\d+))?\\)|\\[(\\d+)(?:${SEP}(\\d+))?\\]`;

// Fresh regex per call — a shared global-flag RegExp keeps lastIndex state and would
// desync across the enricher and the bullet parser.
export function segmentRefRegex(flags = 'i') {
  return new RegExp(CORE, flags);
}

// Match the FIRST segment ref in a string. Returns { start, end } (end falls back to
// start for a single-segment ref) or null when there's no ref.
export function matchSegmentRef(str) {
  if (!str) return null;
  const m = str.match(segmentRefRegex('i'));
  if (!m) return null;
  const start = parseInt(m[1] || m[3], 10);
  const end = parseInt(m[2] || m[4] || m[1] || m[3], 10);
  return { start, end };
}

// Replace EVERY segment ref in `text` with its resolved timecode, preserving the
// original delimiter style (parens stay parens, brackets stay brackets). `resolve`
// maps a segment number → a short timecode string, or returns a falsy value when
// that segment has no known timecode — in which case the ref is left untouched
// (better a raw "(Segments 9)" than a wrong/blank timecode).
export function enrichSegmentRefs(text, resolve) {
  if (!text) return text;
  return text.replace(segmentRefRegex('gi'), (match, pStart, pEnd, bStart, bEnd) => {
    const isBracket = bStart != null;
    const startNum = isBracket ? bStart : pStart;
    const endNum = isBracket ? bEnd : pEnd;
    const startTc = resolve(parseInt(startNum, 10));
    if (!startTc) return match;
    let inner = startTc;
    if (endNum != null) {
      const endTc = resolve(parseInt(endNum, 10));
      if (endTc) inner = `${startTc} – ${endTc}`;
    }
    return isBracket ? `[${inner}]` : `(${inner})`;
  });
}
