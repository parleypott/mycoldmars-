// Single source of truth for the Interpreter's clock-style time labels
// (player playhead / total duration, soundbite-sequence totals).
//
// History: two inline MM:SS formatters drifted apart and BOTH dropped the
// hour — media-deck.js's player label showed "75:30" for a 1h15m30s playhead,
// and main.js's formatDuration tail showed "90:00" for a 1h30m soundbite
// total. Johnny edits hour-plus interview footage, so an hour-plus playhead /
// duration is the COMMON case, not an edge case. Same hour-drop class fixed in
// the Hunter's gemini formatSeconds. This formatter carries the hour.
//
// Sub-hour output is byte-identical to the old inline code for any non-negative
// finite input (m = floor(secs/60), s = floor(secs)%60), so consolidating is
// zero-regression for the common short clip; only hour-plus and non-finite
// inputs change.
export function formatClock(secs) {
  if (!isFinite(secs)) return '0:00';
  const total = Math.floor(Math.max(0, secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
