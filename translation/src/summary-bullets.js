// Interpreter — summary-bullet parser (extracted from main.js for testability).
//
// parseSummaryBullets turns a model-written transcript summary (markdown) into the
// structured bullets the UI links back to transcript SEGMENTS: click a summary bullet
// → jump to its segment range. Each bullet carries { segmentStart, segmentEnd } resolved
// either from its OWN "(Segments X-Y)" / "[X-Y]" ref or inherited from its section header.
//
// BUG FIXED IN EXTRACTION: a section header WITHOUT a segment range used to leave the
// running sectionSegStart/sectionSegEnd untouched — so every bullet under a rangeless
// section silently inherited the PREVIOUS section's range and mis-linked to the wrong
// segments. A new section means "no known range yet", so a rangeless header now RESETS
// the running range to null. (Per-bullet refs still win; sections that declare a range
// are unchanged.)

export function parseSummaryBullets(rawText) {
  if (!rawText) return [];
  const lines = rawText.split('\n');
  const bullets = [];
  let id = 0;
  // Track current section's segment range (from headers like **Title (Segments 15-18)**)
  let sectionSegStart = null;
  let sectionSegEnd = null;
  let sectionTitle = null;

  for (const line of lines) {
    // Check for section header (bold or markdown heading)
    const isHeader = line.startsWith('**') || line.startsWith('## ') || line.startsWith('# ');
    if (isHeader) {
      // Clean header text: strip ** and ## prefixes
      sectionTitle = line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();

      const headerSegMatch = line.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
      if (headerSegMatch) {
        sectionSegStart = parseInt(headerSegMatch[1] || headerSegMatch[3]);
        sectionSegEnd = parseInt(headerSegMatch[2] || headerSegMatch[4] || headerSegMatch[1] || headerSegMatch[3]);
      } else {
        // A new section with no declared range carries NO inherited range — reset, don't
        // bleed the previous section's range onto this section's bullets.
        sectionSegStart = null;
        sectionSegEnd = null;
      }
      continue;
    }

    // Match bullet lines starting with "- ", "N. ", or "• "
    const bulletMatch = line.match(/^(?:[-•]|\d+\.)\s+(.+)/);
    if (!bulletMatch) continue;

    const text = bulletMatch[1];
    // Check for per-bullet segment refs: (Segments X-Y), (Segment X), [X-Y], [X]
    const bulletSegMatch = text.match(/(?:\(Segments?\s+(\d+)(?:\s*[-–]\s*(\d+))?\)|\[(\d+)(?:\s*[-–]\s*(\d+))?\])/i);
    let segStart, segEnd;
    if (bulletSegMatch) {
      segStart = parseInt(bulletSegMatch[1] || bulletSegMatch[3]);
      segEnd = parseInt(bulletSegMatch[2] || bulletSegMatch[4] || bulletSegMatch[1] || bulletSegMatch[3]);
    } else {
      // Inherit from section header
      segStart = sectionSegStart;
      segEnd = sectionSegEnd;
    }

    bullets.push({ id: id++, rawText: text, enrichedText: '', sectionTitle, segmentStart: segStart, segmentEnd: segEnd });
  }
  return bullets;
}
