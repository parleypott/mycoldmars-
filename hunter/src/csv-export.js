// Pure CSV builder for The Hunter's corpus export (the data-honesty download
// producers open in a spreadsheet). Extracted from main.js so it can be
// unit-tested headlessly.
//
// BUG FIXED here (truthy-zero trap): the old inline escaper was
//   csvEscape = (s) => `"${String(s || '').replace(/"/g, '""')}"`
// The row builder deliberately preserves a 0 keepability_score with `?? ''`
// (a real, meaningful "definitely cut this" signal on the 0-1 scale), but
// `String(s || '')` then clobbered the number 0 back to an EMPTY cell — losing
// the single most decisive value in the export. csvCell now uses a null-check
// (`s == null ? '' : String(s)`) so a numeric 0 round-trips as "0" while
// null/undefined still become an empty cell. Byte-identical for every string
// input (every other column already coalesces to '' at the source), so the
// only behavior change is the 0 case the bug ate. Zero regression.

export const CORPUS_CSV_HEADERS = [
  'clip_name', 'project', 'tier', 'start', 'end', 'keepability',
  'shot_type', 'camera_movement', 'editorial_function', 'emotional_register',
  'analysis_preview',
];

// Quote + escape one cell. Preserves a numeric 0 (the bug); null/undefined -> ''.
export function csvCell(s) {
  return `"${(s == null ? '' : String(s)).replace(/"/g, '""')}"`;
}

// Build the full CSV string from corpus units. fmtTc formats a seconds value
// (injected — the shared formatTc) into the start/end timecode cells.
export function buildCorpusCsv(units, fmtTc) {
  const rows = (units || []).map((u) => {
    const j = u.analyses?.[0]?.output_json || {};
    const text = (u.analyses?.[0]?.output_text || '').slice(0, 200).replace(/\n/g, ' ');
    return [
      u.source_clip_name || '',
      u.media_assets?.hunter_projects?.name || '',
      u.media_assets?.tier || '',
      fmtTc(u.start_seconds),
      fmtTc(u.end_seconds),
      j.keepability_score ?? '',
      j.shot_type || '',
      j.camera_movement || '',
      j.editorial_function || '',
      j.emotional_register || '',
      text,
    ].map(csvCell).join(',');
  });
  return [CORPUS_CSV_HEADERS.join(','), ...rows].join('\n');
}
