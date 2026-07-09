// prune-ledger.mjs — pure line-surgery for the untested-cores triage ledger.
//
// WHY PURE + SEPARATE: find-untested-cores.mjs walks the repo and process.exit()s
// at module top level, so it can't be imported in a plain test. This tiny module
// holds the one piece of --prune worth locking — the text surgery that drops a
// STALE entry's line — so it can be mutation-tested in isolation.
//
// The ledger's strict convention is ONE entry per physical line:
//     "repo/relative/path.js": { "status": "GLUE", ... },
// so pruning is a line filter, NOT a JSON reserialize. A reserialize would reflow
// every compact one-line entry into multi-line and bury the single real change in
// a 100+-line diff. This keeps the diff to exactly the removed line(s), the way a
// human pruning by hand would.
//
// pruneLedgerText(text, staleKeys) -> { next, pruned, ok }
//   next   : the new file text (unchanged when nothing pruned / on refusal)
//   pruned : the keys whose line was removed
//   ok     : true iff we removed EXACTLY the stale keys AND the result is still
//            valid JSON with every stale key gone. false => caller must refuse to
//            write (protects a future multi-line-formatted ledger from corruption).
//
// KNOWN LIMITATION (by design, safety over completeness): line-surgery can't strip
// a sibling's trailing comma, so removing the LAST entry of a multi-entry object
// would orphan `..},\n}` (invalid JSON) — the helper returns ok:false and the
// caller prunes by hand. Middle entries and lone entries prune cleanly. This is a
// deliberate trade: never corrupt the ledger, even if a rare case needs a hand-edit.

// The JSON key at the head of a `  "key": ...` line (unescaped). Null for any
// line that isn't a top-level `"key":` (values, braces, blank lines).
export function lineKey(line) {
  const m = line.match(/^\s*"((?:[^"\\]|\\.)*)"\s*:/);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
}

export function pruneLedgerText(text, staleKeys) {
  const stale = new Set(staleKeys);
  const pruned = [];
  const kept = text.split('\n').filter((line) => {
    const k = lineKey(line);
    if (k !== null && stale.has(k)) { pruned.push(k); return false; }
    return true;
  });
  const next = kept.join('\n');

  // Only report ok when the surgery is clean: we removed exactly one line per
  // stale key, the output still parses as JSON, and none of the stale keys
  // survive (guards a multi-line entry whose value lines would be left orphaned).
  let ok = false;
  try {
    const parsed = JSON.parse(next);
    const entries = parsed && parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)
      ? parsed.entries
      : parsed;
    ok = pruned.length === stale.size
      && [...stale].every((p) => pruned.includes(p))
      && [...stale].every((p) => !(entries && typeof entries === 'object' && p in entries));
  } catch { ok = false; }

  return { next: ok ? next : text, pruned, ok };
}
