// Tests for picker-config.js — the pure core of the per-project timecode DAY / SEQUENCE picker.
//
// These functions are the SHARED merge/dedup rules that both configForProject (merge persisted
// additions on load) and marks.js (live add) route through. If they drift, the picker and the durable
// store disagree about what a project's days/sequences ARE — a day shows once and vanishes on reload, or
// an added day the parser can't handle bricks the doc-builder. Locked here.
//
// Run: bun burma-script/src/picker-config.test.mjs
import {
  MAX_DAY, normalizeDay, mergeDays, nextDay, cleanSeqName, mergeSequences,
  readPicker, addToPicker, unionPickerConfigs,
} from './picker-config.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${label}: got ${g} want ${w}`); }
};
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log(`FAIL ${label}`); } };

// ── normalizeDay: single-digit shoot days only (the doc parser compiles a [1-9] char-class) ──
eq(normalizeDay(4), 4, 'number 4');
eq(normalizeDay('5'), 5, 'string "5"');
eq(normalizeDay('DAY 6'), 6, 'label "DAY 6"');
eq(normalizeDay(0), null, '0 out of range (parser floor is 1)');
eq(normalizeDay(10), null, '10 out of range (single digit only)');
eq(normalizeDay(MAX_DAY), MAX_DAY, 'MAX_DAY accepted');
eq(normalizeDay('nope'), null, 'non-numeric → null');
eq(normalizeDay(null), null, 'null → null');
eq(normalizeDay(3.5), null, 'non-integer → null');

// ── mergeDays: default ∪ added, sorted, unique, invalids dropped ──
eq(mergeDays([1, 2, 3], [4, 5]), [1, 2, 3, 4, 5], 'append 4,5');
eq(mergeDays([1, 2, 3], [3, 2]), [1, 2, 3], 'dedupe existing');
eq(mergeDays([1, 2, 3], [4, 4, 5]), [1, 2, 3, 4, 5], 'dedupe within added');
eq(mergeDays([3, 1, 2], []), [1, 2, 3], 'sorts the base too');
eq(mergeDays([1, 2, 3], [10, 0, 'x']), [1, 2, 3], 'drops invalid additions');
eq(mergeDays(null, null), [], 'both nullish → empty');

// ── nextDay: one past the max, capped, null when full ──
eq(nextDay([1, 2, 3]), 4, 'after 1-3 → 4');
eq(nextDay([1, 2, 3, 4, 5, 6, 7]), 8, 'after 1-7 → 8 (Palau)');
eq(nextDay([]), 1, 'empty → 1');
eq(nextDay([1, 2, 3, 4, 5, 6, 7, 8, 9]), null, 'full 1-9 → null (hide affordance)');
eq(nextDay([2, 5]), 6, 'sparse → max+1');

// ── cleanSeqName / mergeSequences: case-insensitive dedup, bullet/whitespace strip ──
eq(cleanSeqName(' • James Porter - Interview: '), 'James Porter - Interview:', 'strips bullet + trims');
eq(cleanSeqName('line one\nlast line:'), 'last line:', 'takes the LAST line (SOT registry rule)');
eq(mergeSequences(['A:'], ['a:', 'B:']), ['A:', 'B:'], 'case-insensitive dedupe, first label wins');
eq(mergeSequences(['  X  '], [], ['X']), ['X'], 'trim + dedupe across lists');
eq(mergeSequences(null, undefined), [], 'nullish lists → empty');

// ── readPicker: tolerant of a missing / garbage bag ──
eq(readPicker({ picker: { days: [4], sequences: ['S:'] } }), { days: [4], sequences: ['S:'] }, 'reads a clean bag');
eq(readPicker({}), { days: [], sequences: [] }, 'no picker key → empties');
eq(readPicker(null), { days: [], sequences: [] }, 'null config → empties');
eq(readPicker({ picker: 'nope' }), { days: [], sequences: [] }, 'garbage picker → empties');
eq(readPicker({ picker: { days: [10, 4], sequences: [' • s '] } }), { days: [4], sequences: ['s'] }, 'normalizes on read');

// ── addToPicker: immutable, no-dup, invalid rejected ──
{
  const base = {};
  const r1 = addToPicker(base, 'day', 4);
  ok(r1.changed, 'add day 4 changed');
  eq(r1.config.picker, { days: [4], sequences: [] }, 'day 4 landed');
  ok(base.picker === undefined, 'input NOT mutated');
  const r2 = addToPicker(r1.config, 'day', 4);
  ok(!r2.changed, 'dup day not changed');
  const r3 = addToPicker(r1.config, 'day', 10);
  ok(!r3.changed, 'invalid day (10) rejected');
  const r4 = addToPicker(r1.config, 'sequence', ' • Nile boatman ');
  ok(r4.changed, 'add sequence changed');
  eq(r4.config.picker.sequences, ['Nile boatman'], 'sequence cleaned + landed, days preserved');
  eq(r4.config.picker.days, [4], 'day 4 preserved through a sequence add');
  const r5 = addToPicker(r4.config, 'sequence', 'NILE BOATMAN');
  ok(!r5.changed, 'case-insensitive dup sequence rejected');
  const r6 = addToPicker(base, 'bogus', 1);
  ok(!r6.changed, 'unknown kind → no change');
}

// ── addToPicker preserves NON-picker config keys (never clobbers a teammate's bag) ──
{
  const withOther = { somethingElse: true, picker: { days: [4], sequences: [] } };
  const r = addToPicker(withOther, 'day', 5);
  ok(r.config.somethingElse === true, 'other config keys survive an add');
  eq(r.config.picker.days, [4, 5], 'day appended');
}

// ── unionPickerConfigs: cloud ∪ local so neither side's additions are lost ──
{
  const u = unionPickerConfigs({ picker: { days: [4], sequences: ['A:'] } }, { picker: { days: [5], sequences: ['B:'] } });
  eq(u.picker.days, [4, 5], 'days unioned');
  eq(u.picker.sequences, ['A:', 'B:'], 'sequences unioned');
  const u2 = unionPickerConfigs({ keep: 1, picker: { days: [4] } }, { drop: 2, picker: { days: [5] } });
  ok(u2.keep === 1, 'primary non-picker keys win');
  eq(u2.picker.days, [4, 5], 'still unions picker');
  eq(unionPickerConfigs(null, null), { picker: { days: [], sequences: [] } }, 'both null → empty bag');
}

if (fail === 0) console.log(`PASS — all ${pass} picker-config cases correct`);
else { console.log(`FAIL — ${fail} of ${pass + fail} picker-config cases failed`); process.exit(1); }
