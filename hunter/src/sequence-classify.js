// Sequence classifier for The Hunter's FCP7/Premiere corpus ingest.
//
// classifySequence labels each parsed sequence as one of:
//   on-cam | selects | master | stringout | unknown
// surfaced in the ingest view (every sequence gets this label, see main.js).
//
// Two passes:
//   1. Name-based (strong signals) — checked in PRIORITY ORDER; first match wins,
//      so on-cam beats selects beats master beats stringout when a name matches
//      more than one family.
//   2. Structure-based (weaker signals) — clip count, unique source count, and
//      average clip duration, falling back to 'selects'.
//
// Pure: depends only on the seq object (name + videoTracks[].clips[].{startSeconds,
// endSeconds, sourceFile.name}).
//
// PLURAL FIX: the whole-word tokens carry an optional `s?` so the natural PLURAL
// names match too — `\bselect\b` previously missed "Selects" / "Day 2 Selects"
// (the tool's own namesake AND the most common sequence name), and likewise
// "interviews", "picks", "highlights", "masters", "all clips", "stringouts",
// "dumps" all fell straight through the name pass. The `s?` is additive: every
// singular still matches exactly as before, so only the previously-missed plurals
// newly classify by name (zero regression on any name that already matched).
export function classifySequence(seq) {
  const name = (seq.name || '').toLowerCase();

  // Name-based classification (strong signals)
  if (/\bon.?cam\b|\boc\b|\ba.?cam\b|\btalking.?heads?\b|\binterviews?\b|\bpresenters?\b/.test(name)) return 'on-cam';
  if (/\bselects?\b|\bsels?\b|\bpicks?\b|\bfavorites?\b|\bfavs?\b|\bbest\b|\bhighlights?\b/.test(name)) return 'selects';
  if (/\bmasters?\b|\bfinals?\b|\bedits?\b|\bassembly\b|\bcuts?\b|\bv\d\b|\brough\b|\bfine\b/.test(name)) return 'master';
  if (/\bstring.?outs?\b|\ball.?clips?\b|\bdumps?\b|\bfull\b/.test(name)) return 'stringout';

  // Structure-based classification (weaker signals)
  const allClips = seq.videoTracks.flatMap(t => t.clips);
  if (allClips.length === 0) return 'unknown';

  const avgDuration = allClips.reduce((sum, c) => sum + (c.endSeconds - c.startSeconds), 0) / allClips.length;
  const uniqueSources = new Set(allClips.map(c => c.sourceFile?.name).filter(Boolean));

  // Single source + many clips = on-cam or stringout
  if (uniqueSources.size <= 2 && allClips.length > 20) return 'stringout';
  // Few sources + short clips = on-cam
  if (uniqueSources.size <= 3 && avgDuration < 15 && allClips.length > 5) return 'on-cam';
  // Many sources + moderate clips = selects
  if (uniqueSources.size > 5 && allClips.length > 3) return 'selects';
  // Long average duration + multiple sources = master
  if (avgDuration > 30 && uniqueSources.size > 3) return 'master';

  return 'selects'; // default to selects for unclassified
}
