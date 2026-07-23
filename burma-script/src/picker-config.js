// Pure helpers for the timecode DAY / SEQUENCE picker's PER-PROJECT custom entries.
//
// The picker (extensions/marks.js) reads its DAY list from the episode config's `days` array and its
// interview SEQUENCE list from the doc + the episode config's `pickerSequences` array. Both were FIXED:
// `days` was a hardcoded literal per episode (config.js / config-for-project.js), so the picker could
// only ever offer the configured days, and there was no way to add a new named sequence that survived
// without being applied to a chip. This module is the shared, engine-free core that lets a project ADD
// a day or a sequence and have it PERSIST: the library stores the additions in script_projects.config
// (per-project jsonb, cloud-synced), and BOTH configForProject (merge on load) and marks.js (live add)
// route through these pure functions so the merge/dedup rules can't drift between the two sites.
//
// DAYS are single-digit shoot-day integers. That is not cosmetic: document-builder.js compiles the day
// list into a `[1-9]`-style regex CHAR CLASS to parse "DAY N" prefixes back out of the saved doc, so a
// day outside 1..9 can't round-trip through the parser and is refused here. SEQUENCES are free-form name
// strings, deduped case-insensitively (matching marks.js's cleanSeqLabel registry key).

export const MAX_DAY = 9;

// Coerce any day input (number, "4", "DAY 4") to a valid single-digit shoot day, or null. Mirrors the
// digit-pulling the TimecodeMark `day` attr does on parse/render so a dirty stored value never leaks.
export function normalizeDay(input) {
  if (input == null) return null;
  const digits = typeof input === 'number' ? String(input) : String(input).match(/\d+/)?.[0];
  if (digits == null) return null;
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAY ? n : null;
}

// Merge a config's default day list with a project's ADDED days → sorted, unique, valid ints. Invalid
// or out-of-range entries (from a hand-edited config or a future schema) are dropped, never thrown on.
export function mergeDays(defaults, added) {
  const seen = new Set();
  const out = [];
  for (const d of [...(Array.isArray(defaults) ? defaults : []), ...(Array.isArray(added) ? added : [])]) {
    const n = normalizeDay(d);
    if (n == null || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

// The next day to offer for "+ Add day": one past the current max, capped at MAX_DAY. Null when full
// (all of 1..9 already present) so the caller can hide the affordance instead of offering a dup.
export function nextDay(days) {
  const valid = (Array.isArray(days) ? days : []).map(normalizeDay).filter((n) => n != null);
  const max = valid.length ? Math.max(...valid) : 0;
  return max < MAX_DAY ? max + 1 : null;
}

// Normalize a sequence NAME to a single clean line (drop leading bullets, collapse whitespace). Kept in
// lockstep with marks.js's cleanSeqLabel so a name added here dedupes to the SAME registry entry a chip's
// stored seq attr would.
export function cleanSeqName(raw) {
  const lines = String(raw == null ? '' : raw)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•●∙-]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// Merge any number of sequence-name lists → deduped case-insensitively, order-preserving (first wins).
export function mergeSequences(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of (Array.isArray(list) ? list : [])) {
      const label = cleanSeqName(raw);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  return out;
}

// Read a project config's picker bag as clean {days, sequences} arrays (tolerant of a missing/garbage
// bag — a hand-edited or older config with no `picker` key degrades to empties, never throws).
export function readPicker(config) {
  const picker = config && typeof config === 'object' && config.picker && typeof config.picker === 'object'
    ? config.picker
    : {};
  return {
    days: mergeDays([], picker.days),
    sequences: mergeSequences(picker.sequences),
  };
}

// Append a day/sequence to a config's picker bag, returning a NEW config object (never mutates the
// input). No-op-returns the same-shaped bag when the value is invalid or already present, so callers can
// compare and skip a redundant write. `kind` is 'day' | 'sequence'.
export function addToPicker(config, kind, value) {
  const base = config && typeof config === 'object' ? config : {};
  const cur = readPicker(base);
  if (kind === 'day') {
    const n = normalizeDay(value);
    if (n == null) return { config: base, changed: false };
    if (cur.days.includes(n)) return { config: base, changed: false };
    const next = { ...base, picker: { days: mergeDays(cur.days, [n]), sequences: cur.sequences } };
    return { config: next, changed: true };
  }
  if (kind === 'sequence') {
    const label = cleanSeqName(value);
    if (!label) return { config: base, changed: false };
    if (cur.sequences.some((s) => s.toLowerCase() === label.toLowerCase())) return { config: base, changed: false };
    const next = { ...base, picker: { days: cur.days, sequences: mergeSequences(cur.sequences, [label]) } };
    return { config: next, changed: true };
  }
  return { config: base, changed: false };
}

// Union two project configs' picker bags (cloud ∪ local), preferring `primary` for any NON-picker keys.
// The cloud config PATCH replaces the whole jsonb column, so two teammates each adding a day race; a
// background hydrate / cloud merge unions the two picker lists here so neither side's additions are lost,
// and the system converges as each client re-writes its unioned view. Returns a NEW config object.
export function unionPickerConfigs(primary, secondary) {
  const a = primary && typeof primary === 'object' ? primary : {};
  const b = secondary && typeof secondary === 'object' ? secondary : {};
  const pa = readPicker(a);
  const pb = readPicker(b);
  return {
    ...b,
    ...a,
    picker: {
      days: mergeDays(pa.days, pb.days),
      sequences: mergeSequences(pa.sequences, pb.sequences),
    },
  };
}
