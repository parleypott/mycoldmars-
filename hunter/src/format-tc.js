// Shared timecode formatters for The Hunter.
//
// Both the on-screen clip/scene/corpus timecodes (formatTc, display) and the
// "Focus on the segment from X to Y" instruction fed to Gemini in the worker
// (formatClipTime) used to be inline MM:SS formatters with NO hour carry:
//   `${Math.floor(s/60)}:${pad(s%60)}`
// So an hour-plus clip rendered "61:40" instead of "1:01:40" — squarely in
// range for Johnny's hour-long interview footage, both in the UI and in the
// timecodes the model reads to reason about a clip. Same hour-drop class as the
// SRT / player / api/gemini.js formatSeconds fixes. These carry the hour.
//
// Sub-hour output is byte-identical to the old inline code (formatTc 2-pads the
// minutes, formatClipTime does not), so consolidating is zero-regression on the
// common short clip; only the hour-plus and non-finite cases change.

// Display timecode: "MM:SS" sub-hour, "H:MM:SS" hour-plus, "--:--" for bad input.
export function formatTc(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Prompt timecode (unpadded minutes): "M:SS" sub-hour, "H:MM:SS" hour-plus.
export function formatClipTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}
