// Pure parser for the "enriched" summary path — used for pre-existing transcripts
// that have NO raw markdown summary, so the bullet structure is recovered from the
// already-enriched text and timecodes are reverse-mapped to segment numbers.
//
// Extracted out of main.js for testability. The only dependency on the rest of the
// app is the reverse map `tcToSeg` (short-form timecode string -> segment number),
// which the caller builds from the live `segments` array + fmtShortTimecode and
// injects here. Keeping it pure means the segment-linking logic is unit-testable.
//
// Sibling of parseSummaryBullets (summary-bullets.js, the raw-summary path). Both
// carry the SAME rule: a section header with NO declared range must RESET the running
// range so bullets under it don't silently inherit the PREVIOUS section's segments.

export function parseEnrichedSummaryBullets(enrichedText, tcToSeg = {}) {
  if (!enrichedText) return [];

  const lines = enrichedText.split('\n');
  const bullets = [];
  let id = 0;
  let sectionSegStart = null;
  let sectionSegEnd = null;
  let sectionTitle = null;

  for (const line of lines) {
    // Section header, e.g. **Intro (0:38 – 6:00)** / ## Heading / # Heading
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
      const tcMatch = line.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
      if (tcMatch) {
        sectionSegStart = tcToSeg[tcMatch[1]] || null;
        sectionSegEnd = tcToSeg[tcMatch[2]] || null;
      } else {
        const singleTcMatch = line.match(/\((\d+:\d+(?::\d+)?)\)/);
        if (singleTcMatch) {
          sectionSegStart = tcToSeg[singleTcMatch[1]] || null;
          sectionSegEnd = sectionSegStart;
        } else {
          // A new section with NO declared range means "no known range yet" — reset
          // so bullets under it don't inherit the previous section's range. Per-bullet
          // refs below still win. (The bug this fixes: rangeless headers kept the prior
          // section's segments, mis-linking those bullets.)
          sectionSegStart = null;
          sectionSegEnd = null;
        }
      }
      continue;
    }

    const bulletMatch = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1];
    // Per-bullet timecodes or [X-Y] segment refs override the section range.
    let segStart = sectionSegStart;
    let segEnd = sectionSegEnd;
    const bulletTcMatch = text.match(/\((\d+:\d+(?::\d+)?)\s*[–—-]\s*(\d+:\d+(?::\d+)?)\)/);
    if (bulletTcMatch) {
      segStart = tcToSeg[bulletTcMatch[1]] || segStart;
      segEnd = tcToSeg[bulletTcMatch[2]] || segEnd;
    } else {
      const bracketMatch = text.match(/\[(\d+)(?:\s*[-–]\s*(\d+))?\]/);
      if (bracketMatch) {
        segStart = parseInt(bracketMatch[1]);
        segEnd = bracketMatch[2] ? parseInt(bracketMatch[2]) : segStart;
      }
    }

    bullets.push({ id: id++, rawText: text, enrichedText: text, sectionTitle, sectionTitleEnriched: sectionTitle, segmentStart: segStart, segmentEnd: segEnd });
  }
  return bullets;
}
