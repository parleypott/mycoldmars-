/*
 * fc-flag-runs.test.mjs — locks findPendingFcRuns (marks.js), the pure core of the FACT-CHECK
 * FLAG feature (brand-new in the collab reliability wave, commit 2b9892d). This function walks
 * the doc and returns every contiguous run of a factCheckSpan mark still awaiting verification.
 * fcFlagPlugin turns each run into the little red SQUARE FLAG at the end of an unverified claim
 * (the ONLY click target that opens the Workshop VERIFY dock) — so this decides which of Johnny's
 * flagged claims still show as "not checked yet" in the LIVE collab editor he + his editors use.
 * It shipped with zero coverage while its siblings from the same commit (collab-echo/seed/anchors,
 * fc-flag extension, version-beacon, image-drop) all got locked.
 *
 * The contract this locks (all verified against the real ProseMirror schema, then mutation-proven):
 *   1. ONE unchecked claim  → exactly one run spanning its text, status 'pending'.
 *   2. ADJACENT fc fragments of the same claim MERGE into one run (a claim split by an embedded
 *      timecode chip is ONE flag — the whole point of the contiguity walk).
 *   3. 'checked' claims are RETIRED — they produce no run (the flag vanishes once the receipt lands).
 *   4. 'solid' keeps a flag and carries status 'solid' (amber/"feels right, not fully checked").
 *   5. A pending fragment directly followed by a checked one flags ONLY the pending part.
 *   6. Two claims separated by a block boundary or plain prose stay SEPARATE runs.
 *
 * Every assertion is mutation-proven load-bearing on the shipped marks.js:
 *   • M1 — force a new run every node (kill the `open.to === pos` merge) → §2 RED (merged→2 runs).
 *   • M2 — force status 'pending' (drop the `=== 'solid' ? 'solid'` branch) → §4 RED (solid lost).
 *   • M3 — drop the `status !== 'checked'` filter (treat checked as pending) → §3 + §5 RED.
 *
 * Run: bun src/extensions/fc-flag-runs.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { findPendingFcRuns } from './marks.js';
import { BURMA_NODES } from './blocks.js';
import { BURMA_TABLE_NODES } from './table.js';
import { BURMA_MARKS } from './marks.js';
import { DirectionMark } from './direction-chip.js';

// The same schema the live editor + migrate-doc save gate enforce (mirrors chapter-frames.test).
const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const fc = schema.marks.factCheckSpan;
const tc = schema.marks.timecode;
const t = (text, status) => schema.text(text, status ? [fc.create({ status })] : []);
// An fc fragment that ALSO carries a timecode chip mark — a different mark set, so ProseMirror
// keeps it as its OWN text node (adjacent same-mark nodes auto-merge; a different mark set does
// not). This is how a real claim gets split into fragments the contiguity walk must re-join.
const tcFrag = (text, status) => schema.text(text, [fc.create({ status }), tc.create({ tc: text })]);
const p = (...kids) => schema.node('paragraph', null, kids);
const doc = (...blocks) => schema.node('doc', null, blocks);
const runs = (d) => findPendingFcRuns(d, fc);

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// §1 — one unchecked claim → exactly one run, status 'pending', spanning just its text.
ok('one pending claim → single pending run', () => {
  const d = doc(p(t('plain '), t('the claim', 'pending')));
  const r = runs(d);
  assert.equal(r.length, 1, 'expected exactly one run');
  assert.equal(r[0].status, 'pending');
  assert.equal(d.textBetween(r[0].from, r[0].to, ''), 'the claim', 'run must cover only the marked text');
});

// §2 — MERGE: a claim split into 3 separate text nodes by an embedded timecode chip collapses to
// ONE run (one flag, not three). This is the load-bearing contiguity walk — the whole reason the
// function re-joins fragments instead of trusting node boundaries; M1 (kill the merge) reddens here.
ok('a timecode-split claim merges into one run', () => {
  const d = doc(p(t('in ', 'pending'), tcFrag('00:04:30:00', 'pending'), t(' it happened', 'pending')));
  assert.equal(d.firstChild.childCount, 3, 'sanity: the claim really is 3 separate text nodes');
  const r = runs(d);
  assert.equal(r.length, 1, 'the fragmented claim must be ONE run, not one flag per fragment');
  assert.equal(d.textBetween(r[0].from, r[0].to, ''), 'in 00:04:30:00 it happened', 'run must span the whole claim');
});

// §3 — a 'checked' claim is retired: no run, no flag.
ok("checked claim produces no run", () => {
  assert.equal(runs(doc(p(t('verified fact', 'checked')))).length, 0);
});

// §4 — 'solid' keeps a flag and carries its distinct status.
ok("solid claim keeps a flag with status 'solid'", () => {
  const r = runs(doc(p(t('feels right', 'solid'))));
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'solid', "solid must survive as 'solid', not collapse to 'pending'");
});

// §5 — pending fragment then checked fragment → flag ONLY the pending part (checked ends the run).
ok('pending-then-checked flags only the pending fragment', () => {
  const d = doc(p(t('unsure', 'pending'), t('sure', 'checked')));
  const r = runs(d);
  assert.equal(r.length, 1);
  assert.equal(d.textBetween(r[0].from, r[0].to, ''), 'unsure', 'the checked tail must not extend the flag');
});

// §6 — two claims kept separate by a block boundary AND by plain prose → two runs.
ok('claims separated by block boundary stay separate', () => {
  assert.equal(runs(doc(p(t('c1', 'pending')), p(t('c2', 'pending')))).length, 2);
});
ok('claims separated by plain prose stay separate', () => {
  assert.equal(runs(doc(p(t('a', 'pending'), t(' and ', null), t('b', 'pending')))).length, 2);
});

console.log(`fc-flag-runs.test.mjs — ${pass} assertions passed`);
