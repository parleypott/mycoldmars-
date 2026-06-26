// Pure formatters for the Interpreter upload dialog's stat pills
// (file size + duration). Extracted from dialogs.js so the boundary
// behavior is mutation-locked — see format-pills.test.mjs.

// Human-readable byte size. Rollover-safe across unit boundaries: a value
// one byte under 1 MiB used to render as "1024 KB" (and one under 1 GiB as
// "1024.0 MB") because each tier's toFixed() rounds the displayed number up
// to a full next unit. We re-check the ROUNDED value and promote to the
// larger unit so the pill reads "1.0 MB" / "1.00 GB" instead. Same class as
// the views-growth "1000K"->"1.0M" and westchester "$1000K" rollover fixes.
// Well-formed mid-range values are byte-identical to the old inline version.
export function fmtBytes(n) {
  const KB = 1024, MB = 1024 * 1024, GB = 1024 * 1024 * 1024;
  if (n >= GB) return (n / GB).toFixed(2) + ' GB';
  if (n >= MB) {
    if (Number((n / MB).toFixed(1)) >= 1024) return (n / GB).toFixed(2) + ' GB';
    return (n / MB).toFixed(1) + ' MB';
  }
  if (n >= KB) {
    if (Number((n / KB).toFixed(0)) >= 1024) return (n / MB).toFixed(1) + ' MB';
    return (n / KB).toFixed(0) + ' KB';
  }
  return n + ' B';
}

// Coarse duration label: "Xh Ym" once hours are present (seconds dropped by
// design at that scale), else "Mm Ss", else "Ss". Falsy/non-finite -> "—".
export function fmtDuration(seconds) {
  if (!seconds || !isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
