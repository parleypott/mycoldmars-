/**
 * Tests for worklists.js — the WP-01 Burma Script editor's producer-facing handoff
 * extraction. The "service need" concept (MAP NEEDS / ARCHIVE) was removed, so only the
 * TRANSLATION worklist (SOT speaker quotes) + the .txt download body remain.
 * Run: node src/worklists.test.mjs
 */
import { buildWorklists, toPlainText, actionable } from './worklists.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };

// ── buildWorklists: chapter spine + SOT (translation) routing only ────────────────────
// Former map-need / archive-req blocks are now neutral 'bin' blocks and must NOT appear in
// any worklist — buildWorklists returns ONLY { translation }.
const blocks = [
  { id: 'c1', type: 'chapter', title: 'GROUND 1. Yangon' },
  { id: 'b1', type: 'bin', text: 'river-sea confluence' }, // ex map-need — ignored by worklists
  { id: 's1', type: 'sot', text: 'JH there are British buildings everywhere', timecode: { tc: '02:02:01:07' }, speaker: 'JH', done: false },
  { id: 'c2', type: 'chapter', title: 'GROUND 2. Mandalay' },
  { id: 's2', type: 'sot', text: 'Jack on colonization', timecode: { tc: '01:27:17:06' }, done: true },
];
const wl = buildWorklists(blocks);
const { translation } = wl;

ok(wl.maps === undefined, 'no maps worklist (service need removed)');
ok(wl.archive === undefined, 'no archive worklist (service need removed)');

eq(translation.length, 2, 'two SOT rows');
eq(translation[0].primary, '02:02:01:07', 'SOT primary is the timecode');
eq(translation[0].meta, 'JH · GROUND 1. Yangon', 'SOT meta = speaker · chapter');
eq(translation[0].done, false, 'SOT done false');
eq(translation[1].meta, '(speaker TBD) · GROUND 2. Mandalay', 'missing speaker → TBD, new chapter');
eq(translation[1].done, true, 'SOT done flag carried');

// SOT with no timecode falls back to the dashed placeholder
const tNoTc = buildWorklists([{ id: 's', type: 'sot', text: 'x', speaker: 'A' }]).translation[0];
eq(tNoTc.primary, '——:——:——:——', 'SOT no-tc placeholder');

// ── actionable: passthrough for translation rows (no empty flag) ──────────────────────
eq(actionable(translation).length, 2, 'actionable keeps all SOT rows');

// ── toPlainText: numbering, meta/body indent, DONE flag, multi-line body ──────────────
const txt = toPlainText('Archive requests', 'Burma — A Country at War', [
  { id: 'a', primary: '1962 coup', meta: 'GROUND 1', body: '1962 coup' },
  { id: 'b', primary: 'kings', meta: 'GROUND 2', body: '• kings\n• cities' },
], {});
const tl = txt.split('\n');
eq(tl[0], 'Burma — A Country at War', 'txt line 1 = doc title');
eq(tl[1], 'ARCHIVE REQUESTS', 'txt line 2 = uppercased heading');
ok(tl[2].includes('· 2 items'), 'txt generated line has item count');
ok(txt.includes('01.  1962 coup'), 'txt numbered row 01');
ok(txt.includes('02.  kings'), 'txt numbered row 02');
ok(txt.includes('     • kings\n     • cities'), 'txt multi-line body indented per line');

// DONE flag only when opts.done set
const txtDone = toPlainText('Translation', 'Doc', [
  { id: 'x', primary: '00:00:01:00', meta: 'A', body: 'hi', done: true },
], { done: true });
ok(txtDone.includes('00:00:01:00  [DONE]'), 'txt DONE flag when opts.done + row.done');
const txtNoDone = toPlainText('Translation', 'Doc', [
  { id: 'x', primary: '00:00:01:00', meta: 'A', body: 'hi', done: true },
], {});
ok(!txtNoDone.includes('[DONE]'), 'txt no DONE flag when opts.done unset');

console.log(`\nworklists: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
