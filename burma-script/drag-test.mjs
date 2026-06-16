// WP-01 Burma Script Tool — POINTER-DRAG PROOF.
// ---------------------------------------------------------------------------
// This is the hard gate for the unified pointer-drag system. It drives the editor with
// REAL PointerEvent + MouseEvent streams (mousedown on a block's spine grip → a series of
// pointermove/mousemove steps → mouseup over a target zone) and asserts the resulting
// ProseMirror document — read from window.__EDITOR__.getJSON() — changed correctly:
//
//   • PAIR    — drop on the RIGHT edge of another block → an `avPair` node now wraps the
//               two as TWO COLUMNS (target LEFT, dragged RIGHT). Both texts survive,
//               top-level block count drops by 1, the DOM shows .wp-avpair with 2 columns
//               and the ⤢ unwrap control.
//   • MERGE   — drop on the CENTER → the two combine into one block (target text THEN
//               dropped text), the dropped node is gone, its text appears exactly once,
//               count -1, no avPair.
//   • REORDER — drop on the TOP band → the dragged node moves above the target, count
//               unchanged, no pair / no merge, both blocks stay separate.
//   • UNWRAP  — the ⤢ control on an avPair pulls it apart into two full-width blocks in
//               document order, count restored, word count preserved through the full
//               PAIR → UNWRAP round-trip.
//
// We use POINTER + MOUSE events (NOT native HTML5 drag-and-drop) precisely because they
// can be driven by a synthetic stream — that's the whole reason the drag system is
// pointer-based. Each intent reloads the page first so every test runs on the pristine
// 225-block document (we clear localStorage so a prior merge can't leak in).
//
// Usage: node burma-script/drag-test.mjs [url]   (default http://localhost:8095/burma-script/)

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8095/burma-script/';

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  PASS  ' + msg); } else { failed++; console.log('  FAIL  ' + msg); } };

// ---- helpers run IN the page ---------------------------------------------

// Word count over the meaningful prose of the live doc (recurses into avPair columns).
// Counts text tokens with a word char — the audit-grade "no word dropped" measure.
const WORDS_FN = () => {
  const J = window.__EDITOR__.getJSON();
  let n = 0;
  (function walk(node) {
    if (node.text) n += node.text.split(/\s+/).filter((w) => /\w/.test(w)).length;
    (node.content || []).forEach(walk);
  })(J);
  return n;
};

// Top-level block count, ignoring the trailing empty paragraph the framework auto-appends
// on a delete (it carries no content, so it never counts as a meaningful block).
const TOPCOUNT_FN = () => {
  const J = window.__EDITOR__.getJSON();
  const top = J.content || [];
  let n = 0;
  for (const b of top) {
    if (b.type === 'paragraph') {
      const t = (b.content || []).map((c) => c.text || '').join('').trim();
      if (!t) continue; // skip stray empty trailing paragraph
    }
    n++;
  }
  return n;
};

// ---- pointer-drag driver (runs IN the page) ------------------------------
// Finds the Nth meaningful block's spine grip, presses it, walks the pointer to a point
// inside the target block's chosen zone, and releases. Fires BOTH PointerEvent and
// MouseEvent at each step (the grip listens on pointerdown+mousedown; the gesture driver
// listens on pointermove/mousemove + pointerup/mouseup with capture). Returns geometry for
// debugging. `zone`: 'pair' (right edge), 'merge' (center), 'reorder-top', 'reorder-bottom'.
const DRAG_IN_PAGE = ({ fromIdx, toIdx, zone }) => {
  const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > .wp-avpair, .ProseMirror > section.wp-cart')];
  // Only blocks that own a spine grip are draggable sources.
  const blocks = carts.filter((c) => c.querySelector(':scope > .wp-spine > .wp-grip, :scope .wp-spine > .wp-grip'));
  const from = blocks[fromIdx];
  const to = blocks[toIdx];
  if (!from || !to) return { err: `missing block from=${fromIdx} to=${toIdx} of ${blocks.length}` };
  const grip = from.querySelector('.wp-spine .wp-grip');
  if (!grip) return { err: 'no grip on from block' };

  const gr = grip.getBoundingClientRect();
  const tr = to.getBoundingClientRect();
  const sx = gr.left + gr.width / 2, sy = gr.top + gr.height / 2;

  // Pick a destination point inside the target's chosen zone.
  let tx, ty;
  if (zone === 'pair') { tx = tr.left + tr.width * 0.92; ty = tr.top + tr.height / 2; }
  else if (zone === 'merge') { tx = tr.left + tr.width * 0.5; ty = tr.top + tr.height / 2; }
  else if (zone === 'reorder-top') { tx = tr.left + tr.width * 0.5; ty = tr.top + tr.height * 0.08; }
  else if (zone === 'reorder-bottom') { tx = tr.left + tr.width * 0.5; ty = tr.bottom - tr.height * 0.08; }
  else return { err: 'bad zone ' + zone };

  // Build explicit event sequence: press on grip, move across window, release at target.
  const pdown = (x, y) => {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    grip.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
    grip.dispatchEvent(new MouseEvent('mousedown', base));
  };
  const pmove = (x, y) => {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1 };
    window.dispatchEvent(new PointerEvent('pointermove', { ...base, pointerId: 1, isPrimary: true }));
    window.dispatchEvent(new MouseEvent('mousemove', base));
  };
  const pup = (x, y) => {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 0 };
    window.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
    window.dispatchEvent(new MouseEvent('mouseup', base));
  };

  pdown(sx, sy);
  const STEPS = 14;
  for (let i = 1; i <= STEPS; i++) {
    const x = sx + (tx - sx) * (i / STEPS);
    const y = sy + (ty - sy) * (i / STEPS);
    pmove(x, y);
  }
  pup(tx, ty);
  return { ok: true, sx, sy, tx, ty, blocks: blocks.length };
};

// Click the ⤢ unwrap control on the avPair at top-level index `pairTopIdx`.
const UNWRAP_IN_PAGE = () => {
  const pair = document.querySelector('.ProseMirror > .wp-avpair');
  if (!pair) return { err: 'no avPair in dom' };
  const split = pair.querySelector('.wp-avpair-split');
  if (!split) return { err: 'no ⤢ control' };
  const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
  split.dispatchEvent(new MouseEvent('mousedown', base));
  split.dispatchEvent(new MouseEvent('mouseup', base));
  split.dispatchEvent(new MouseEvent('click', base));
  return { ok: true };
};

// Reset: clear persisted doc + reload so each intent runs on the pristine 225-block doc.
async function fresh(page) {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__EDITOR__ && window.__EDITOR__.getJSON().content.length > 50, null, { timeout: 20000 });
  await page.waitForTimeout(300);
}

// Find indices of two adjacent DRAGGABLE blocks of given types (by node type), returning
// their positions among the draggable-grip blocks (matching DRAG_IN_PAGE's `blocks` list).
// We choose a pair where the LEFT is "words" (vo/oncam/sot) and RIGHT is "picture" (broll)
// when possible so the A/V read is real; else any two adjacent pairable blocks.
const FIND_PAIR_FN = () => {
  const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > .wp-avpair, .ProseMirror > section.wp-cart')];
  const blocks = carts.filter((c) => c.querySelector('.wp-spine .wp-grip'));
  const typeOf = (el) => {
    if (el.hasAttribute('data-vo')) return 'voBlock';
    if (el.hasAttribute('data-oncam')) return 'oncamBlock';
    if (el.hasAttribute('data-sot')) return 'sotBlock';
    if (el.hasAttribute('data-broll')) return 'brollBlock';
    if (el.hasAttribute('data-scene')) return 'sceneBlock';
    if (el.hasAttribute('data-note')) return 'noteBlock';
    if (el.hasAttribute('data-bin')) return 'binBlock';
    if (el.hasAttribute('data-service')) return 'serviceBlock';
    if (el.hasAttribute('data-chapter')) return 'chapterBlock';
    return '?';
  };
  const PAIRABLE = new Set(['voBlock', 'oncamBlock', 'sotBlock', 'brollBlock', 'sceneBlock', 'noteBlock', 'binBlock', 'serviceBlock']);
  const WORDS = new Set(['voBlock', 'oncamBlock', 'sotBlock']);
  // Prefer an adjacent (words-left, picture-right) couple.
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = typeOf(blocks[i]), b = typeOf(blocks[i + 1]);
    if (WORDS.has(a) && b === 'brollBlock') return { left: i, right: i + 1, leftType: a, rightType: b };
  }
  // Else any two adjacent pairable blocks.
  for (let i = 0; i < blocks.length - 1; i++) {
    const a = typeOf(blocks[i]), b = typeOf(blocks[i + 1]);
    if (PAIRABLE.has(a) && PAIRABLE.has(b)) return { left: i, right: i + 1, leftType: a, rightType: b };
  }
  return { err: 'no adjacent pairable couple' };
};

// Plain text of a top-level node by index (recurses), trimmed + whitespace-collapsed.
const NODE_TEXT_FN = (idx) => {
  const J = window.__EDITOR__.getJSON();
  const node = (J.content || [])[idx];
  if (!node) return null;
  let s = '';
  (function walk(n) { if (n.text) s += n.text; (n.content || []).forEach(walk); })(node);
  return s.replace(/\s+/g, ' ').trim();
};

// Count top-level avPair nodes.
const AVPAIR_COUNT_FN = () => (window.__EDITOR__.getJSON().content || []).filter((n) => n.type === 'avPair').length;

// ---- the run --------------------------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));

console.log('DRAG TEST →', URL, '\n');

try {
  // ============ PAIR ============
  console.log('PAIR — right-edge drop creates avPair (target LEFT, dragged RIGHT):');
  await fresh(page);
  {
    const couple = await page.evaluate(FIND_PAIR_FN);
    ok(!couple.err, `found adjacent pairable couple (${couple.leftType} | ${couple.rightType})`);
    const beforeCount = await page.evaluate(TOPCOUNT_FN);
    const beforeWords = await page.evaluate(WORDS_FN);
    // Source = the RIGHT block (the picture); target = the LEFT block (the words). Dropping
    // the picture onto the words' right edge docks it RIGHT, words stay LEFT.
    const leftText = await page.evaluate(FIND_PAIR_FN).then(() => null);
    const targetTextBefore = await page.evaluate((i) => {
      const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > section.wp-cart')].filter((c)=>c.querySelector('.wp-spine .wp-grip'));
      const el = carts[i]; let s=''; (function w(n){ s+=n.innerText||''; })(el); return s.replace(/\s+/g,' ').trim();
    }, couple.left);
    const draggedTextBefore = await page.evaluate((i) => {
      const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > section.wp-cart')].filter((c)=>c.querySelector('.wp-spine .wp-grip'));
      const el = carts[i]; return (el.innerText||'').replace(/\s+/g,' ').trim();
    }, couple.right);

    const res = await page.evaluate(DRAG_IN_PAGE, { fromIdx: couple.right, toIdx: couple.left, zone: 'pair' });
    ok(res.ok, 'pointer drag executed (right block → left block right edge)');
    await page.waitForTimeout(350);

    const afterCount = await page.evaluate(TOPCOUNT_FN);
    const pairCount = await page.evaluate(AVPAIR_COUNT_FN);
    ok(pairCount === 1, `exactly one avPair node now exists (got ${pairCount})`);
    ok(afterCount === beforeCount - 1, `top-level count dropped by 1 (${beforeCount} → ${afterCount})`);

    // DOM shows .wp-avpair with 2 columns + the ⤢ control.
    const dom = await page.evaluate(() => {
      const p = document.querySelector('.ProseMirror > .wp-avpair');
      if (!p) return { exists: false };
      const cols = p.querySelector('.wp-avpair-cols');
      return {
        exists: true,
        colCount: cols ? cols.children.length : 0,
        hasSplit: !!p.querySelector('.wp-avpair-split'),
        leftText: cols && cols.children[0] ? (cols.children[0].innerText || '').replace(/\s+/g, ' ').trim() : '',
        rightText: cols && cols.children[1] ? (cols.children[1].innerText || '').replace(/\s+/g, ' ').trim() : '',
      };
    });
    ok(dom.exists, 'DOM has .wp-avpair');
    ok(dom.colCount === 2, `avPair renders 2 columns (got ${dom.colCount})`);
    ok(dom.hasSplit, 'avPair shows the ⤢ unwrap control');

    // Both texts survive, in the right columns. We compare on the prose word-stems so the
    // column chrome labels (kind tags, REC, etc.) don't trip the check.
    const stem = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 3).slice(0, 6).join(' ');
    ok(dom.leftText && stem(targetTextBefore) && dom.leftText.toLowerCase().includes(stem(targetTextBefore).split(' ')[0] || 'xxxxx'), 'LEFT column carries the TARGET (words) text');
    ok(dom.rightText && draggedTextBefore && dom.rightText.toLowerCase().includes((stem(draggedTextBefore).split(' ')[0]) || 'xxxxx'), 'RIGHT column carries the DRAGGED (picture) text');

    const afterWords = await page.evaluate(WORDS_FN);
    ok(afterWords === beforeWords, `word count preserved through PAIR (${beforeWords} → ${afterWords})`);
  }

  // ============ MERGE ============
  console.log('\nMERGE — center drop combines two blocks into one (text-after-text):');
  await fresh(page);
  {
    const couple = await page.evaluate(FIND_PAIR_FN);
    const beforeCount = await page.evaluate(TOPCOUNT_FN);
    const beforeWords = await page.evaluate(WORDS_FN);
    const targetTextBefore = await page.evaluate((i) => {
      const J = window.__EDITOR__.getJSON();
      // map draggable-grip index → top-level node index by walking grip blocks order == doc order
      return null;
    }, couple.left);

    // Grab the dragged block's prose text BEFORE the merge (from the DOM source order).
    const srcTexts = await page.evaluate(({ l, r }) => {
      const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > section.wp-cart')].filter((c)=>c.querySelector('.wp-spine .wp-grip'));
      const txt = (el) => (el.querySelector('.wp-body') ? el.querySelector('.wp-body').innerText : el.innerText || '').replace(/\s+/g, ' ').trim();
      return { left: txt(carts[l]), right: txt(carts[r]) };
    }, { l: couple.left, r: couple.right });

    // Drag the RIGHT block onto the CENTER of the LEFT block → LEFT absorbs RIGHT's text after its own.
    const res = await page.evaluate(DRAG_IN_PAGE, { fromIdx: couple.right, toIdx: couple.left, zone: 'merge' });
    ok(res.ok, 'pointer drag executed (right block → left block center)');
    await page.waitForTimeout(350);

    const afterCount = await page.evaluate(TOPCOUNT_FN);
    const pairCount = await page.evaluate(AVPAIR_COUNT_FN);
    ok(pairCount === 0, 'no avPair created by a center drop');
    ok(afterCount === beforeCount - 1, `top-level count dropped by 1 (${beforeCount} → ${afterCount})`);

    // The merged block holds the target text THEN the dropped text; the dropped block is gone.
    const merged = await page.evaluate(() => {
      // find the block that now contains BOTH source prose chunks — just return all top-level prose.
      const J = window.__EDITOR__.getJSON();
      return (J.content || []).map((n) => { let s=''; (function w(x){ if(x.text)s+=x.text; (x.content||[]).forEach(w);})(n); return s.replace(/\s+/g,' ').trim(); });
    });
    const allText = merged.join('\n');
    const leftStem = (srcTexts.left || '').slice(0, 24);
    const rightStem = (srcTexts.right || '').slice(0, 24);
    const mergedBlock = merged.find((b) => leftStem && rightStem && b.includes(leftStem.slice(0, 12)) && b.includes(rightStem.slice(0, 12)));
    ok(!!mergedBlock, 'a single block now contains BOTH the target and dropped text');
    if (mergedBlock) {
      ok(mergedBlock.indexOf(leftStem.slice(0, 12)) < mergedBlock.indexOf(rightStem.slice(0, 12)), 'target text comes BEFORE dropped text (text-after-text)');
    }
    // The dropped (right) prose appears exactly once across the whole doc.
    const occurrences = (allText.match(new RegExp(rightStem.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    ok(rightStem.length >= 12 ? occurrences === 1 : true, `dropped text appears exactly once (got ${occurrences})`);

    const afterWords = await page.evaluate(WORDS_FN);
    ok(afterWords === beforeWords, `word count preserved through MERGE (${beforeWords} → ${afterWords})`);
  }

  // ============ REORDER ============
  console.log('\nREORDER — top-band drop moves the dragged node above the target:');
  await fresh(page);
  {
    // Use two blocks a few apart so a move is unambiguous. Drag block #8 onto the TOP band
    // of block #3 → #8 lands above #3; count unchanged, no pair, no merge.
    const fromIdx = 8, toIdx = 3;
    const beforeCount = await page.evaluate(TOPCOUNT_FN);
    const beforeWords = await page.evaluate(WORDS_FN);
    const draggedText = await page.evaluate((i) => {
      const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > section.wp-cart')].filter((c)=>c.querySelector('.wp-spine .wp-grip'));
      const el = carts[i]; return ((el.querySelector('.wp-body')?.innerText) || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    }, fromIdx);
    const targetText = await page.evaluate((i) => {
      const carts = [...document.querySelectorAll('.ProseMirror > .wp-cart, .ProseMirror > section.wp-cart')].filter((c)=>c.querySelector('.wp-spine .wp-grip'));
      const el = carts[i]; return ((el.querySelector('.wp-body')?.innerText) || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    }, toIdx);

    const res = await page.evaluate(DRAG_IN_PAGE, { fromIdx, toIdx, zone: 'reorder-top' });
    ok(res.ok, 'pointer drag executed (block 8 → top band of block 3)');
    await page.waitForTimeout(350);

    const afterCount = await page.evaluate(TOPCOUNT_FN);
    const pairCount = await page.evaluate(AVPAIR_COUNT_FN);
    ok(pairCount === 0, 'no avPair created by a reorder');
    ok(afterCount === beforeCount, `top-level count UNCHANGED (${beforeCount} → ${afterCount})`);

    // The dragged block now sits immediately above the target (document order).
    const order = await page.evaluate(() => {
      const J = window.__EDITOR__.getJSON();
      return (J.content || []).map((n) => { let s=''; (function w(x){ if(x.text)s+=x.text;(x.content||[]).forEach(w);})(n); return s.replace(/\s+/g,' ').trim().slice(0,30); });
    });
    const di = order.findIndex((t) => draggedText && t.startsWith(draggedText.slice(0, 14)));
    const ti = order.findIndex((t) => targetText && t.startsWith(targetText.slice(0, 14)));
    ok(di >= 0 && ti >= 0, 'both dragged + target blocks still present (separate)');
    ok(di >= 0 && ti >= 0 && di === ti - 1, `dragged block now sits directly ABOVE the target (dragged@${di}, target@${ti})`);

    const afterWords = await page.evaluate(WORDS_FN);
    ok(afterWords === beforeWords, `word count preserved through REORDER (${beforeWords} → ${afterWords})`);
  }

  // ============ PULL-APART (round-trip) ============
  console.log('\nPULL-APART — ⤢ unwraps an avPair back into two full-width blocks:');
  await fresh(page);
  {
    const couple = await page.evaluate(FIND_PAIR_FN);
    const beforeCount = await page.evaluate(TOPCOUNT_FN);
    const beforeWords = await page.evaluate(WORDS_FN);

    // First make a pair (RIGHT → LEFT right edge).
    await page.evaluate(DRAG_IN_PAGE, { fromIdx: couple.right, toIdx: couple.left, zone: 'pair' });
    await page.waitForTimeout(300);
    const pairedCount = await page.evaluate(TOPCOUNT_FN);
    ok(await page.evaluate(AVPAIR_COUNT_FN) === 1, 'pair created for the round-trip');
    ok(pairedCount === beforeCount - 1, `count -1 while paired (${beforeCount} → ${pairedCount})`);

    // Grab the two columns' STABLE blockIds before unwrap — unambiguous identity (prose can
    // repeat across 219 blocks), so the order check is exact.
    const colIds = await page.evaluate(() => {
      const pair = window.__EDITOR__.getJSON().content.find((n) => n.type === 'avPair');
      return (pair.content || []).map((c) => (c.attrs && c.attrs.blockId) || null);
    });
    ok(colIds[0] && colIds[1] && colIds[0] !== colIds[1], 'both columns carry distinct blockIds');

    // Now pull apart via the ⤢ control.
    const u = await page.evaluate(UNWRAP_IN_PAGE);
    ok(u.ok, '⤢ control clicked');
    await page.waitForTimeout(300);

    const restoredCount = await page.evaluate(TOPCOUNT_FN);
    ok(await page.evaluate(AVPAIR_COUNT_FN) === 0, 'avPair removed after unwrap');
    ok(restoredCount === beforeCount, `top-level count RESTORED (${beforeCount} → ${restoredCount})`);

    // The two former columns are back as full-width top-level blocks in document order
    // (former LEFT then former RIGHT), matched by their exact blockIds.
    const idOrder = await page.evaluate(() => (window.__EDITOR__.getJSON().content || []).map((n) => (n.attrs && n.attrs.blockId) || null));
    const li = idOrder.indexOf(colIds[0]);
    const ri = idOrder.indexOf(colIds[1]);
    ok(li >= 0 && ri >= 0 && li === ri - 1, `former LEFT then RIGHT, adjacent + in order (left@${li}, right@${ri})`);

    const afterWords = await page.evaluate(WORDS_FN);
    ok(afterWords === beforeWords, `word count preserved through full PAIR→UNWRAP round-trip (${beforeWords} → ${afterWords})`);
  }

  // ============ no page errors during any drag ============
  console.log('\nINTEGRITY:');
  ok(pageErrors.length === 0, `no page errors during any drag (got ${pageErrors.length}${pageErrors.length ? ': ' + pageErrors[0] : ''})`);

} catch (e) {
  failed++;
  console.log('  FAIL  harness threw: ' + (e && e.stack ? e.stack : e));
} finally {
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? 'PASS' : 'FAIL');
process.exit(failed === 0 ? 0 : 1);
