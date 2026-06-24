// Locks the PinGlobe FEEDBACK VIEWER's store reader (pinglobe-feedback/index.html).
//
// The viewer is Johnny's admin window into player feedback. It reads the SAME
// 'pg-feedback' localStorage key the game writes (same origin). The game's
// writer was already hardened (pinglobe/src/feedback-store.js → parseFeedbackList),
// but this read-only viewer kept the raw inline form:
//
//   const entries = JSON.parse(localStorage.getItem('pg-feedback') || '[]');
//
// — NO try/catch, and it trusted the result to be an array. A corrupt/legacy
// store blanked the whole page two ways:
//   (1) MALFORMED JSON   -> JSON.parse throws at load -> render() never runs.
//   (2) valid-but-NON-array ('{}', '5', 'null', '"x"') -> render does
//       `[...data].reverse()` which throws "data is not iterable".
//
// parseFeedbackList below is BYTE-IDENTICAL to the function now shipped inline in
// pinglobe-feedback/index.html — keep them in sync. It returns [] for any
// non-array / unparseable / missing value; a real array passes through verbatim.
//
// run: node pinglobe-feedback/feedback-viewer.test.mjs   (or: bun run test)

// ---- shipped function (keep identical to pinglobe-feedback/index.html) ----
function parseFeedbackList(raw) {
  if (raw == null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ---- the OLD unguarded form, reconstructed for the mutation (RED) proof ----
// Mirrors exactly what shipped before: `JSON.parse(raw || '[]')` then trusted.
function oldInline(raw) {
  return JSON.parse(raw || '[]');
}

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---------- common case: a real array round-trips verbatim (zero regression) ----------
const real = JSON.stringify([
  { text: 'great game', ts: 1718900000000 },
  { text: 'add more clues', ts: 1718900500000 },
]);
ok('real array passes through with same length', parseFeedbackList(real).length === 2);
ok('real array preserves entry text',  parseFeedbackList(real)[0].text === 'great game');
ok('real array preserves entry ts',    parseFeedbackList(real)[1].ts === 1718900500000);
ok('empty array stays empty',          Array.isArray(parseFeedbackList('[]')) && parseFeedbackList('[]').length === 0);

// ---------- missing / null input ----------
ok('null raw -> []',       Array.isArray(parseFeedbackList(null)) && parseFeedbackList(null).length === 0);
ok('undefined raw -> []',  Array.isArray(parseFeedbackList(undefined)) && parseFeedbackList(undefined).length === 0);

// ---------- (1) MALFORMED JSON -> guard yields [], old form THROWS ----------
const malformed = ['{bad json', '[1,2,', 'undefined', '{"text":', "{'x':1}", '[,]'];
for (const m of malformed) {
  ok(`malformed ${JSON.stringify(m)} -> [] (no throw)`,
     Array.isArray(parseFeedbackList(m)) && parseFeedbackList(m).length === 0);
  // MUTATION PROOF: the old inline form throws on this exact input.
  ok(`RED: old inline THROWS on malformed ${JSON.stringify(m)}`, throws(() => oldInline(m)));
}

// ---------- (2) valid-but-NON-array -> guard yields [], old form returns a
//             non-array that crashes render's [...data].reverse() ----------
const nonArrays = ['{}', '{"text":"hi"}', '5', '0', '"x"', 'true', 'null'];
for (const v of nonArrays) {
  ok(`non-array ${JSON.stringify(v)} -> [] (no throw)`,
     Array.isArray(parseFeedbackList(v)) && parseFeedbackList(v).length === 0);
  // MUTATION PROOF: old inline returns a value that is NOT a usable array, so the
  // viewer's `[...data].reverse()` would throw (objects/numbers/booleans/null are
  // not iterable). A bare string '"x"' parses to "x" which IS spreadable but is
  // still wrong data — the array guard is what makes it safe.
  const old = oldInline(v);
  ok(`RED: old inline yields NON-array on ${JSON.stringify(v)}`, !Array.isArray(old));
}

// '{}' and '5' are the load-bearing non-iterables: prove the crash the guard prevents.
ok('RED: spread of old inline {} throws (not iterable)', throws(() => [...oldInline('{}')]));
ok('RED: spread of old inline 5 throws (not iterable)',  throws(() => [...oldInline('5')]));
ok('guard makes {} safe to spread', (() => { try { [...parseFeedbackList('{}')]; return true; } catch { return false; } })());
ok('guard makes 5 safe to spread',  (() => { try { [...parseFeedbackList('5')];  return true; } catch { return false; } })());

console.log(`pinglobe-feedback viewer: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
