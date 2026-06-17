/**
 * Tests for migrate-doc.js — the WP-01 Burma Script editor's SAFE MIGRATION HARNESS, specifically
 * its ADDITIVE FILL-SAFE TRANSFORMS that run (once, gated) over Johnny's already-saved doc:
 *   (A) stamp a `day` attr onto every `timecode` mark from the nearest preceding "DAY N", and
 *   (B) reclassify a colonless-VO `binBlock` → `voBlock`.
 * Run: node src/migrate-doc.test.mjs  (auto-discovered by `bun run test`)
 *
 * HEADLINE BUG (fixed): day-threading reset at every paragraph break. scene/chapter blocks emit
 * TWO paragraphs — a heading para (which carries "PAGODA: DAY 2") and a body para (which carries
 * embedded timecodes the parser pulled out of the title). transformBlockNode called
 * stampDaysInParagraph once per paragraph with the SAME block-level seedDay (null for scene/
 * chapter), so a "DAY 2" learned in the heading was discarded before the body paragraph ran — the
 * body timecode chip never got its DAY prefix, contradicting the module's stated intent ("the
 * nearest preceding DAY N within the SAME cartridge block"). Fix: stampDaysInParagraph returns the
 * running day on exit, and transformBlockNode threads it across the block's paragraphs.
 *
 * The regression-lock cases pin the already-correct behavior (single-paragraph stamping, sot/broll
 * block-level seed, existing-day marks left alone, in-prose DAY override, text-preservation, the
 * clone guarantee, and the (B) bin→vo reclassification) so the threading fix can't regress.
 */
import {
  stampDaysInParagraph,
  transformBlockNode,
  applyAdditiveTransforms,
  binLooksLikeVo,
} from './migrate-doc.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };

// ── node builders ─────────────────────────────────────────────────────────────────────────────
const tcMark = (day = null) => ({ type: 'timecode', attrs: { day } });
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...inlines) => ({ type: 'paragraph', content: inlines });
const block = (type, attrs, ...content) => ({ type, attrs, content });
const wrapDoc = (...blocks) => ({
  type: 'doc',
  content: blocks.map((b) => ({
    type: 'tableRow', attrs: { cols: 1 },
    content: [{ type: 'tableCell', attrs: { role: 'full' }, content: [b] }],
  })),
});
// reach the block inside row r of a wrapped doc
const blkOf = (doc, r = 0) => doc.content[r].content[0].content[0];

// ── stampDaysInParagraph: now returns { changed, day } ──────────────────────────────────────────
{
  const p = para(text('DAY 2 '), text('02:00:00:00', [tcMark()]));
  const r = stampDaysInParagraph(p, null);
  eq(typeof r, 'object', 'stamp returns an object');
  eq(r.changed, true, 'stamp: changed=true when it stamps a mark');
  eq(r.day, 2, 'stamp: returns the running day on exit (for caller threading)');
  eq(p.content[1].marks[0].attrs.day, 2, 'stamp: timecode mark gets in-prose DAY 2');
}
{
  // seedDay used when no in-prose DAY N; exit day == seedDay
  const p = para(text('02:00:00:00', [tcMark()]));
  const r = stampDaysInParagraph(p, 3);
  eq(r.day, 3, 'stamp: exit day == seedDay when no in-prose DAY');
  eq(p.content[0].marks[0].attrs.day, 3, 'stamp: timecode gets seedDay');
  eq(r.changed, true, 'stamp: changed when seedDay applied');
}
{
  // a mark that ALREADY has a day is left alone
  const p = para(text('DAY 1 '), text('tc', [tcMark(2)]));
  const r = stampDaysInParagraph(p, null);
  eq(p.content[1].marks[0].attrs.day, 2, 'stamp: existing day attr untouched');
  eq(r.changed, false, 'stamp: no change when only mark already has a day');
}
{
  // no timecode, no DAY → nothing changes, exit day == seed (null)
  const p = para(text('just prose'));
  const r = stampDaysInParagraph(p, null);
  eq(r.changed, false, 'stamp: no change on plain prose');
  eq(r.day, null, 'stamp: exit day stays null on plain prose');
}
{
  // non-text inlines ignored, no throw
  const p = { type: 'paragraph', content: [{ type: 'hardBreak' }, null, text('tc', [tcMark()])] };
  const r = stampDaysInParagraph(p, 1);
  eq(p.content[2].marks[0].attrs.day, 1, 'stamp: skips non-text inlines safely');
  ok(r.changed === true, 'stamp: still stamps the real text node');
}

// ── transformBlockNode: cross-paragraph threading (THE FIX) ─────────────────────────────────────
{
  // HEADLINE: scene heading "DAY 2" must reach the BODY paragraph's timecode.
  const scene = block('sceneBlock', { blockId: 's1' },
    para(text('PAGODA: DAY 2')),
    para(text('02:45:36:15', [tcMark()])));
  const changed = transformBlockNode(scene);
  eq(changed, true, 'scene: transform reports changed');
  eq(scene.content[1].content[0].marks[0].attrs.day, 2,
    'scene: heading DAY 2 threads to body-paragraph timecode (cross-paragraph fix)');
}
{
  // chapter block, same shape — heading DAY 3 → body timecode
  const chap = block('chapterBlock', { blockId: 'c1', genre: 'other' },
    para(text('COLD OPEN: DAY 3')),
    para(text('01:00:00:00', [tcMark()])));
  transformBlockNode(chap);
  eq(chap.content[1].content[0].marks[0].attrs.day, 3, 'chapter: heading DAY 3 threads to body timecode');
}
{
  // sot block: block-level day seeds its single paragraph
  const sot = block('sotBlock', { blockId: 'q1', day: 1 },
    para(text('02:00:00:00', [tcMark()]), text(' she said')));
  transformBlockNode(sot);
  eq(sot.content[0].content[0].marks[0].attrs.day, 1, 'sot: block-level day seeds the timecode');
}
{
  // sot block: in-prose DAY overrides the block seed for a LATER timecode in the same block
  const sot = block('sotBlock', { blockId: 'q2', day: 1 },
    para(text('tc-a', [tcMark()])),
    para(text('DAY 2 later '), text('tc-b', [tcMark()])));
  transformBlockNode(sot);
  eq(sot.content[0].content[0].marks[0].attrs.day, 1, 'sot: first timecode keeps block seed day 1');
  eq(sot.content[1].content[1].marks[0].attrs.day, 2, 'sot: in-prose DAY 2 overrides seed for later timecode');
}
{
  // (B) colonless-VO binBlock → voBlock, text-preserving
  const bin = block('binBlock', { blockId: 'b1', scaffold: false },
    para(text('VO: the Myanmar out here was quiet')));
  const changed = transformBlockNode(bin);
  eq(changed, true, 'binVo: transform reports changed');
  eq(bin.type, 'voBlock', 'binVo: bin retyped to voBlock');
  eq(bin.attrs.status, 'todo', 'binVo: voBlock gains default todo status');
  eq(bin.attrs.blockId, 'b1', 'binVo: blockId preserved');
}
{
  // a scaffold bin is NOT retyped
  const bin = block('binBlock', { blockId: 'b2', scaffold: true }, para(text('VO: scaffold note')));
  transformBlockNode(bin);
  eq(bin.type, 'binBlock', 'binVo: scaffold bin left as binBlock');
}

// ── binLooksLikeVo regression locks ─────────────────────────────────────────────────────────────
ok(binLooksLikeVo(block('binBlock', {}, para(text('VO: narration')))), 'looksVo: "VO:" matches');
ok(binLooksLikeVo(block('binBlock', {}, para(text('-[MAP] + VO the river')))), 'looksVo: cued "-[MAP] + VO" matches');
ok(!binLooksLikeVo(block('binBlock', {}, para(text('just a holding note')))), 'looksVo: plain prose does NOT match');
ok(!binLooksLikeVo(block('binBlock', {}, para(text('VOTING happened')))), 'looksVo: "VOTING" (no boundary) does NOT match');

// ── applyAdditiveTransforms: end-to-end over the wrapped doc ─────────────────────────────────────
{
  // The headline case end-to-end (RED before the fix: body day stayed null).
  const doc = wrapDoc(block('sceneBlock', { blockId: 's1' },
    para(text('PAGODA: DAY 2')),
    para(text('02:45:36:15', [tcMark()]))));
  const { doc: out, changed } = applyAdditiveTransforms(doc);
  eq(changed, true, 'apply: changed=true');
  const m = blkOf(out).content[1].content[0].marks[0];
  eq(m.attrs.day, 2, 'apply: scene body timecode threaded to DAY 2 end-to-end');
}
{
  // clone guarantee — the original input doc is NOT mutated
  const doc = wrapDoc(block('sceneBlock', { blockId: 's1' },
    para(text('DAY 2')),
    para(text('tc', [tcMark()]))));
  applyAdditiveTransforms(doc);
  eq(blkOf(doc).content[1].content[0].marks[0].attrs.day, null, 'apply: original doc left untouched (deep clone)');
}
{
  // text-preservation: stamping a day adds NO text, retyping adds NO text
  const doc = wrapDoc(
    block('sceneBlock', { blockId: 's1' }, para(text('DAY 1')), para(text('02:00:00:00', [tcMark()]))),
    block('binBlock', { blockId: 'b1', scaffold: false }, para(text('VO: a line'))));
  const allText = (d) => JSON.stringify(d).match(/"text":"[^"]*"/g).sort().join('|');
  const before = allText(doc);
  const { doc: out } = applyAdditiveTransforms(doc);
  eq(allText(out), before, 'apply: transforms preserve every text node (no word added/dropped)');
}
{
  // no-op: a sot block whose timecode already carries a day, no DAY prose → changed=false
  const doc = wrapDoc(block('sotBlock', { blockId: 'q', day: null },
    para(text('02:00:00:00', [tcMark(2)]), text(' stable'))));
  const { changed } = applyAdditiveTransforms(doc);
  eq(changed, false, 'apply: no-op when nothing to stamp');
}
{
  // robustness: rows/cells/blocks that aren't the expected shape don't throw
  const weird = { type: 'doc', content: [null, { type: 'tableRow', content: [null, { type: 'tableCell', content: [null] }] }] };
  let threw = false;
  try { applyAdditiveTransforms(weird); } catch { threw = true; }
  ok(!threw, 'apply: malformed doc shape handled without throwing');
}

console.log(`\nmigrate-doc: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
