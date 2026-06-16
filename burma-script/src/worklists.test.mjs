/**
 * Tests for worklists.js — the WP-01 Burma Script editor's producer-facing handoff
 * extraction (MAP NEEDS / ARCHIVE / TRANSLATION worklists + the .txt download body).
 * Run: node src/worklists.test.mjs
 *
 * Headline bug (fixed in cleanBody): the parser stores service-block bodies with U+2043
 * hyphen-bullets ("⁃ item"). cleanBody split them into a clean "• item" checklist ONLY when
 * there were 2+ items — for a SINGLE-item section (e.g. one archival clip) it returned the
 * raw string, leaking the parser's "⁃" bullet straight into the producer's .txt handoff and
 * on-screen list. So single-item rows read "⁃ 1962 coup footage" while multi-item rows read
 * "• …" — raw markup in a producer-facing document, and inconsistent. stripSpanScaffolding
 * (which runs after cleanBody) only strips braces/brackets, so it did NOT mask the leak.
 *
 * The fix returns parts[0] (the de-bulleted single item, or the whole plain-prose body)
 * instead of the raw `t`. The surrounding cases lock in the already-correct multi-item,
 * label-strip, empty-flag, chapter spine, SOT extraction, and .txt formatting behavior so
 * the fix can't regress.
 */
import { buildWorklists, cleanBody, toPlainText, actionable } from './worklists.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };

const B = '⁃'; // ⁃ U+2043 hyphen bullet, exactly what the parser emits

// ── HEADLINE: single-item bodies must NOT leak the raw ⁃ bullet ───────────────────────
eq(cleanBody(`\\[Archive request for this section: ${B} 1962 coup footage.\\]`),
   '1962 coup footage.', 'single archive item — no raw bullet leak');
eq(cleanBody(`\\[Mapping data needs: ${B} Rohingya displacement routes\\]`),
   'Rohingya displacement routes', 'single map item — no raw bullet leak');
// the raw U+2043 must never survive in single-item output
ok(!cleanBody(`\\[Mapping data needs: ${B} just one thing\\]`).includes(B),
   'single item output contains no U+2043');

// ── REGRESSION: multi-item still becomes a clean • checklist ──────────────────────────
eq(cleanBody(`\\[Mapping data needs: ${B} coup routes ${B} city growth ${B} gold temples\\]`),
   '• coup routes\n• city growth\n• gold temples', 'multi-item — clean bullet checklist');
eq(cleanBody(`\\[Archive request: ${B} kings ${B} cities\\]`),
   '• kings\n• cities', 'multi archive — clean bullet checklist');

// ── REGRESSION: plain prose with no bullet returns clean, whole ───────────────────────
eq(cleanBody('Just a sentence of mapping context, no bullets.'),
   'Just a sentence of mapping context, no bullets.', 'plain prose unchanged');
eq(cleanBody(`\\[Mapping data needs: a single prose line with no bullet\\]`),
   'a single prose line with no bullet', 'single prose after label strip');

// ── REGRESSION: empty / whitespace / label-only bodies ────────────────────────────────
eq(cleanBody(''), '', 'empty string');
eq(cleanBody(null), '', 'null body');
eq(cleanBody('\\[Mapping data needs: \\]'), '', 'label-only map body → empty');
eq(cleanBody(`\\[Archive request for this section: ${B}\\]`), '', 'lone bullet → empty');

// ── REGRESSION: markdown unescape ─────────────────────────────────────────────────────
eq(cleanBody(`\\[Archive request: ${B} GOLD\\!\\! temples ${B} kings\\]`),
   '• GOLD!! temples\n• kings', 'escaped !! unescaped in items');

// ── buildWorklists: chapter spine + map/archive/translation routing ───────────────────
const blocks = [
  { id: 'c1', type: 'chapter', title: 'GROUND 1. Yangon' },
  { id: 'm1', type: 'map-need', title: 'Mapping data needs', text: `\\[Mapping data needs: ${B} river-sea confluence\\]` },
  { id: 'a1', type: 'archive-req', title: 'Archive request', text: `\\[Archive request: ${B} 1962 coup\\]` },
  { id: 's1', type: 'sot', text: 'JH there are British buildings everywhere', timecode: { tc: '02:02:01:07' }, speaker: 'JH', done: false },
  { id: 'c2', type: 'chapter', title: 'GROUND 2. Mandalay' },
  { id: 's2', type: 'sot', text: 'Jack on colonization', timecode: { tc: '01:27:17:06' }, done: true },
  { id: 'm2', type: 'map-need', title: 'Mapping data needs', text: '\\[Mapping data needs: \\]' }, // empty stub
];
const { maps, archive, translation } = buildWorklists(blocks);

eq(maps.length, 2, 'two map-need rows');
eq(maps[0].body, 'river-sea confluence', 'map row body clean (single item, no bullet)');
eq(maps[0].meta, 'GROUND 1. Yangon', 'map row carries its chapter');
eq(maps[0].empty, false, 'filled map row not empty');
eq(maps[1].empty, true, 'default+blank map row flagged empty');

eq(archive.length, 1, 'one archive row');
eq(archive[0].body, '1962 coup', 'archive row body clean (single item, no bullet)');
eq(archive[0].meta, 'GROUND 1. Yangon', 'archive row chapter');

eq(translation.length, 2, 'two SOT rows');
eq(translation[0].primary, '02:02:01:07', 'SOT primary is the timecode');
eq(translation[0].meta, 'JH · GROUND 1. Yangon', 'SOT meta = speaker · chapter');
eq(translation[0].done, false, 'SOT done false');
eq(translation[1].meta, '(speaker TBD) · GROUND 2. Mandalay', 'missing speaker → TBD, new chapter');
eq(translation[1].done, true, 'SOT done flag carried');

// SOT with no timecode falls back to the dashed placeholder
const tNoTc = buildWorklists([{ id: 's', type: 'sot', text: 'x', speaker: 'A' }]).translation[0];
eq(tNoTc.primary, '——:——:——:——', 'SOT no-tc placeholder');

// ── actionable: drops empty placeholders ──────────────────────────────────────────────
eq(actionable(maps).length, 1, 'actionable drops the empty map stub');
eq(actionable(archive).length, 1, 'actionable keeps archive (no empty flag)');
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
