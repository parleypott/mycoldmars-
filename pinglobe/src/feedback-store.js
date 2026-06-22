// Parse the 'pg-feedback' localStorage value into a GUARANTEED array.
//
// The feedback-submit handler does `const stored = parseFeedbackList(...);
// stored.push(entry)`. The old inline form was
// `const stored = JSON.parse(localStorage.getItem('pg-feedback') || '[]')`
// with NO try/catch — so a corrupt/legacy store crashed the submit two ways:
//   (1) MALFORMED JSON  -> JSON.parse threw, unhandled -> handler crash.
//   (2) valid-but-NON-array ('{}', '5', '"x"', 'null') -> stored.push is not a
//       function -> crash.
// 'pg-feedback' is only ever written as JSON.stringify(<array>), so a non-array
// is corruption/legacy — latent today, but a real crash with no recovery.
//
// Returns [] for any non-array / unparseable / missing value; a real array
// passes through verbatim (byte-identical for the common case -> zero regression).
export function parseFeedbackList(raw) {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
