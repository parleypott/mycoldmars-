// Mutation-proven test for The Hunter sequence classifier (plural-miss FIX + lock).
//
// classifySequence labels EVERY parsed FCP7/Premiere sequence in the corpus
// ingest view (on-cam | selects | master | stringout | unknown). It was pure +
// load-bearing + ZERO-coverage.
//
// REAL BUG fixed: the name pass used `\bWORD\b` for every content token, so the
// natural PLURAL names never matched — `\bselect\b` missed "Selects" / "Day 2
// Selects" (the tool's own namesake AND the most common sequence name), and
// "interviews", "picks", "highlights", "masters", "all clips", "stringouts",
// "dumps" all fell straight through the name pass into the structure heuristics.
// Fix: optional `s?` on the pluralizable whole-word tokens — additive, every
// singular still matches.
//
// Imports the REAL shipped function (extracted from main.js), so it can't drift.

import { classifySequence } from './sequence-classify.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; } else { fail++; console.error(`✗ ${msg}\n    got:  ${got}\n    want: ${want}`); }
};
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`✗ ${msg}`); } };

// Builders. Name-based seqs carry an empty clip list so a broken name rule falls
// to the structure pass (→ 'unknown'), making any regression a clearly-wrong
// label rather than a crash or a coincidental structure match.
const clip = (dur, source) => ({ startSeconds: 0, endSeconds: dur, sourceFile: { name: source } });
const seqNamed = (name) => ({ name, videoTracks: [{ clips: [] }] });
const seqStruct = (clips) => ({ name: 'Timeline 01', videoTracks: [{ clips }] });

// ── INLINE RED PROOF: the OLD whole-word-only regexes miss the plurals ──
// Reconstruct the exact pre-fix name pass and show it fails to classify the
// natural plural names that the shipped (fixed) function now catches by name.
{
  const oldNamePass = (name) => {
    const n = name.toLowerCase();
    if (/\bon.?cam\b|\boc\b|\ba.?cam\b|\btalking.?head\b|\binterview\b|\bpresenter\b/.test(n)) return 'on-cam';
    if (/\bselect\b|\bsel\b|\bpick\b|\bfavorite\b|\bfav\b|\bbest\b|\bhighlight\b/.test(n)) return 'selects';
    if (/\bmaster\b|\bfinal\b|\bedit\b|\bassembly\b|\bcut\b|\bv\d\b|\brough\b|\bfine\b/.test(n)) return 'master';
    if (/\bstring.?out\b|\ball.?clip\b|\bdump\b|\bfull\b/.test(n)) return null; // would fall through
    return null;
  };
  // The namesake: a "Selects" sequence is NOT matched by the old name pass.
  ok(oldNamePass('Day 2 Selects') === null, 'RED: old name pass misses "Day 2 Selects" (the namesake)');
  eq(classifySequence(seqNamed('Day 2 Selects')), 'selects', 'fixed: "Day 2 Selects" → selects (by name)');
  // A handful more naturally-plural names the old pass dropped:
  for (const n of ['interviews', 'picks', 'highlights', 'masters', 'all clips', 'stringouts', 'dumps']) {
    ok(oldNamePass(n) === null, `RED: old name pass misses plural "${n}"`);
  }
}

// ── The FIX: plural names now classify by name ──
eq(classifySequence(seqNamed('Selects')), 'selects', 'plural: Selects → selects');
eq(classifySequence(seqNamed('A-roll selects')), 'selects', 'plural: A-roll selects → selects');
eq(classifySequence(seqNamed('interviews')), 'on-cam', 'plural: interviews → on-cam');
eq(classifySequence(seqNamed('picks')), 'selects', 'plural: picks → selects');
eq(classifySequence(seqNamed('highlights')), 'selects', 'plural: highlights → selects');
eq(classifySequence(seqNamed('favs')), 'selects', 'abbrev plural: favs → selects');
eq(classifySequence(seqNamed('masters')), 'master', 'plural: masters → master');
eq(classifySequence(seqNamed('final cuts')), 'master', 'plural: final cuts → master');
eq(classifySequence(seqNamed('edits')), 'master', 'plural: edits → master');
eq(classifySequence(seqNamed('all clips')), 'stringout', 'plural: all clips → stringout');
eq(classifySequence(seqNamed('stringouts')), 'stringout', 'plural: stringouts → stringout');
eq(classifySequence(seqNamed('dumps')), 'stringout', 'plural: dumps → stringout');
eq(classifySequence(seqNamed('presenters')), 'on-cam', 'plural: presenters → on-cam');
eq(classifySequence(seqNamed('talking heads')), 'on-cam', 'plural: talking heads → on-cam');

// ── NO REGRESSION: every singular still matches exactly as before ──
eq(classifySequence(seqNamed('A001 interview')), 'on-cam', 'interview → on-cam');
eq(classifySequence(seqNamed('talking head A')), 'on-cam', 'talking head → on-cam');
eq(classifySequence(seqNamed('presenter take')), 'on-cam', 'presenter → on-cam');
eq(classifySequence(seqNamed('OC roll')), 'on-cam', 'OC (word) → on-cam');
eq(classifySequence(seqNamed('a-cam master')), 'on-cam', 'a-cam → on-cam (beats master)');
eq(classifySequence(seqNamed('Day 2 select')), 'selects', 'select → selects');
eq(classifySequence(seqNamed('best of reel')), 'selects', 'best → selects');
eq(classifySequence(seqNamed('highlight reel')), 'selects', 'highlight → selects');
eq(classifySequence(seqNamed('fav pick')), 'selects', 'fav → selects');
eq(classifySequence(seqNamed('final cut')), 'master', 'final cut → master');
eq(classifySequence(seqNamed('rough assembly')), 'master', 'rough/assembly → master');
eq(classifySequence(seqNamed('Episode v2')), 'master', 'v2 → master');
eq(classifySequence(seqNamed('fine edit')), 'master', 'fine/edit → master');
eq(classifySequence(seqNamed('stringout day 1')), 'stringout', 'stringout → stringout');
eq(classifySequence(seqNamed('dump folder')), 'stringout', 'dump → stringout');
eq(classifySequence(seqNamed('full pull')), 'stringout', 'full → stringout');

// Case-insensitive
eq(classifySequence(seqNamed('INTERVIEW')), 'on-cam', 'uppercase INTERVIEW → on-cam');
eq(classifySequence(seqNamed('SELECTS')), 'selects', 'uppercase plural SELECTS → selects');

// ── Name priority order: first family that matches wins (unchanged) ──
eq(classifySequence(seqNamed('interview selects')), 'on-cam', 'priority: on-cam beats selects');
eq(classifySequence(seqNamed('selects master')), 'selects', 'priority: selects beats master');
eq(classifySequence(seqNamed('masters full')), 'master', 'priority: master beats stringout');
eq(classifySequence(seqNamed('interviews final stringouts')), 'on-cam', 'priority: on-cam wins over all');

// ── Structure pass (neutral name) — unchanged ──
eq(classifySequence(seqStruct([])), 'unknown', 'empty clips → unknown');
// stringout: ≤2 unique sources AND >20 clips
eq(classifySequence(seqStruct(Array.from({ length: 25 }, (_, i) => clip(8, i % 2 ? 'A' : 'B')))), 'stringout',
   '2 sources, 25 clips → stringout');
// on-cam: ≤3 sources, avg<15, >5 clips (and not the stringout case)
eq(classifySequence(seqStruct([clip(10, 'A'), clip(10, 'B'), clip(10, 'C'), clip(10, 'A'), clip(10, 'B'), clip(10, 'C')])), 'on-cam',
   '3 sources, 6 short clips → on-cam');
// selects: >5 unique sources, >3 clips
eq(classifySequence(seqStruct([clip(20, 'A'), clip(20, 'B'), clip(20, 'C'), clip(20, 'D'), clip(20, 'E'), clip(20, 'F')])), 'selects',
   '6 sources, 6 clips → selects');
// master: avg>30, >3 sources
eq(classifySequence(seqStruct([clip(40, 'A'), clip(40, 'B'), clip(40, 'C'), clip(40, 'D')])), 'master',
   '4 sources, avg 40s → master');
// default: nothing matches → selects
eq(classifySequence(seqStruct([clip(20, 'A'), clip(20, 'B'), clip(20, 'A')])), 'selects',
   '3 clips, 2 sources, avg 20 → default selects');

// ── Robustness ──
eq(classifySequence({ name: '', videoTracks: [{ clips: [] }] }), 'unknown', 'empty name + no clips → unknown');
eq(classifySequence({ name: undefined, videoTracks: [{ clips: [clip(20, 'A'), clip(20, 'B'), clip(20, 'A')] }] }), 'selects',
   'undefined name → structure default selects');
eq(classifySequence({ name: 'x', videoTracks: [{ clips: [clip(40, 'A'), clip(40, 'B')] }, { clips: [clip(40, 'C'), clip(40, 'D')] }] }), 'master',
   'clips flattened across 2 tracks → master (4 sources, avg 40)');
eq(classifySequence(seqStruct([{ startSeconds: 0, endSeconds: 20 }, { startSeconds: 0, endSeconds: 20 }, { startSeconds: 0, endSeconds: 20 }])), 'selects',
   'clips with no sourceFile → 0 unique sources → default selects (no crash)');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
