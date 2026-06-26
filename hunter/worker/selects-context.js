// Builds the textual description of an editorial decision (a "selects" edit) that
// gets EMBEDDED and cross-referenced against raw-footage descriptions in The
// Hunter's editorial-intelligence corpus.
//
// The source/timeline timecodes here used to be rendered by an inline MM:SS
// formatter with NO hour carry (`${Math.floor(s/60)}:${pad(s%60)}`), so an
// hour-plus source range — squarely in range for Johnny's hour-long interview
// footage — embedded as "65:30" instead of "1:05:30". Same hour-drop class as
// the api/gemini.js formatSeconds / Hunter formatTc fixes. We now route through
// the shared, hour-correct formatClipTime (sub-hour output is byte-identical, so
// short clips are unchanged; only hour-plus + non-finite cases differ).

import { formatClipTime } from '../src/format-tc.js';

export function buildSelectsAnalysisContext(unit, rawMatch) {
  const duration = Math.round((unit.endSeconds - unit.startSeconds) * 100) / 100;
  const timelineDuration = Math.round((unit.timelineEnd - unit.timelineStart) * 100) / 100;

  let text = `EDITORIAL DECISION — Selects Tier\n`;
  text += `Sequence: "${unit.sequenceName}"\n`;
  text += `Source clip: ${unit.sourceClipName}\n`;
  text += `Source range: ${formatClipTime(unit.startSeconds)} – ${formatClipTime(unit.endSeconds)} (${duration}s of source used)\n`;
  text += `Timeline position: ${formatClipTime(unit.timelineStart)} – ${formatClipTime(unit.timelineEnd)} (${timelineDuration}s on timeline)\n`;
  text += `Track: ${unit.trackLabel}\n`;

  if (rawMatch) {
    text += `\nCROSS-REFERENCE: This clip matches raw corpus unit ${rawMatch.id}.\n`;
    // Source clip length from the raw match's metadata. A zero-length (single-frame
    // or bad-metadata) or missing/non-finite range must NOT divide into a bogus
    // "Infinity%" / "NaN%" usage figure — that garbage gets EMBEDDED and poisons the
    // editorial corpus the model reasons over. Guard finite & positive before the
    // division; degrade to an honest "unknown" line otherwise. Well-formed ranges
    // are byte-identical to before.
    const sourceLen = rawMatch.end_seconds - rawMatch.start_seconds;
    if (Number.isFinite(sourceLen) && sourceLen > 0) {
      text += `The editor selected ${duration}s from a ${Math.round(sourceLen)}s source clip.\n`;
      const usagePercent = ((duration / sourceLen) * 100).toFixed(1);
      text += `Usage: ${usagePercent}% of source material was used in this edit.\n`;
    } else {
      text += `The editor selected ${duration}s from this source clip (raw source length unavailable).\n`;
      text += `Usage: unknown — raw source length unavailable.\n`;
    }
  } else {
    text += `\nNo raw footage match found for this source clip.\n`;
  }

  return text;
}
