// Shared timecode formatter for the Hunter's Gemini-facing clip ranges.
//
// Renders a duration in seconds as a human-readable timecode. For sub-hour
// values it returns MM:SS (zero-padded minutes) exactly as before; once the
// value reaches an hour it carries the hour into an H:MM:SS form instead of
// letting the minutes field run past 59.
//
// History: the old inline formatSeconds in gemini.js did `Math.floor(s / 60)`
// with no hour carry, so an hour-plus clip rendered "61:01" (or "122:05") —
// ambiguous, wrong timecodes fed straight into the Gemini chat context for
// Johnny's hour-long interview footage. Same hour-drop class as the Interpreter
// SRT/timecode fixes. Pulled out here so it's a single source of truth + testable.
export function formatSeconds(s) {
  if (s == null || !Number.isFinite(Number(s))) return '--:--';
  const total = Math.floor(Number(s));
  const neg = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = abs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${neg}${h}:${mm}:${ss}`;
  return `${neg}${mm}:${ss}`;
}
