// Single source of truth for the summary-timecode DISPLAY formatter.
//
// Takes a timecode in any of the shapes the transcript pipeline produces — a
// plain seconds value ("125" / "125.5"), HH:MM:SS, or MM:SS — and renders it
// for display as H:MM:SS (when there's an hour) or M:SS. Sub-second precision
// is intentionally dropped for the short display.
//
// Extracted VERBATIM from two byte-identical inline copies that lived in
// translation/src/main.js (the standalone fmtShortTimecode + the inner fmtShort
// inside enrichSummaryWithTimecodes). Consolidating kills the divergent-copy
// landmine and gives the formatter test coverage. Behavior is byte-identical to
// the old inline copies for every input.
export function fmtShortTimecode(tc) {
  let secs;
  if (/^\d+(\.\d+)?$/.test(tc)) { secs = parseFloat(tc); }
  else {
    const m = tc.match(/(\d+):(\d+):(\d+)/);
    if (m) secs = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]);
    else { const m2 = tc.match(/(\d+):(\d+)/); secs = m2 ? parseInt(m2[1]) * 60 + parseInt(m2[2]) : 0; }
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
