// Locks the iPad selection-decay fix in the BURGUNDY reader
// (public/burgundy/index.html, commit 2e10d5d, 2026-07-16). Extracted from the
// shipped HTML at runtime so a drift/revert in index.html breaks this test.
//
// THE BUG this pins: offsetInPara(p, node, nodeOffset) maps a selection endpoint
// to a character offset from the paragraph start. The OLD implementation walked
// the paragraph's TEXT nodes and returned the running count only when the
// endpoint's container WAS the matched text node (t === node). But once a
// paragraph carries <mark> highlights, iPad/WebKit routinely reports a selection
// endpoint as an ELEMENT container — the <p> itself or a <mark>, with a
// CHILD-INDEX offset. The text-walk never matched an element container, fell
// through to `return -1`, and the selectionchange handler bailed → the highlight
// pill vanished. It got worse the more highlights existed (more element-shaped
// endpoints), which is why it read as "the selection dies after a few highlights".
//
// THE FIX (locked here): measure with a Range —
//   r.selectNodeContents(p); r.setEnd(node, nodeOffset); return r.toString().length
// A Range counts characters from the paragraph start whether the endpoint
// container is a Text node OR an Element, so an element container now returns the
// correct offset instead of -1. This test proves the shipped form returns the
// right offset for an ELEMENT container while the old text-walk returns -1 on the
// exact same input — so the fix can't silently regress.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// ── extract the real offsetInPara() verbatim ──────────────────────────────────
const m = html.match(/function offsetInPara\(p, node, nodeOffset\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract offsetInPara() from index.html — did the signature change?');
assert.ok(/createRange|selectNodeContents|setEnd/.test(m[0]),
  'offsetInPara must be Range-based (createRange/selectNodeContents/setEnd) — the text-walk form is the iPad bug');

// ── a faithful, minimal DOM model ─────────────────────────────────────────────
// Text node: {nodeType:3, data}. Element: {nodeType:1, childNodes:[...]}.
// rangeText(root, endNode, endOffset) returns the concatenated text of Text nodes
// in DOCUMENT ORDER from the start of `root` up to the boundary (endNode,endOffset).
// This is the standard Range.toString() clipping semantics — computed here
// INDEPENDENTLY of offsetInPara, so the test exercises offsetInPara's real logic
// (which boundary it builds), not a tautology.
function rangeText(root, endNode, endOffset) {
  let out = '';
  let done = false;
  const full = node => {
    if (node.nodeType === 3) { out += node.data; return; }
    for (const c of node.childNodes) full(c);
  };
  const walk = node => {
    if (done) return;
    if (node === endNode) {
      if (node.nodeType === 3) out += node.data.slice(0, endOffset);
      else for (let i = 0; i < endOffset && i < node.childNodes.length; i++) full(node.childNodes[i]);
      done = true;
      return;
    }
    if (node.nodeType === 3) { out += node.data; return; }
    for (const c of node.childNodes) { walk(c); if (done) return; }
  };
  walk(root);
  return out;
}

function makeDocument() {
  return {
    createRange() {
      let startRoot = null, endNode = null, endOffset = 0;
      return {
        selectNodeContents(n) { startRoot = n; endNode = n; endOffset = (n.childNodes || []).length; },
        setEnd(n, o) {
          // A real Range.setEnd throws on a null/invalid container; mirror that so
          // offsetInPara's try/catch (return -1) is exercised, not silently skipped.
          if (!n) throw new Error('setEnd: null container');
          endNode = n; endOffset = o;
        },
        toString() { return rangeText(startRoot, endNode, endOffset); },
      };
    },
  };
}

// ── build a paragraph that carries a <mark>: "keep <mark>cut</mark> keep" ──────
const t1 = { nodeType: 3, data: 'keep ' };
const tc = { nodeType: 3, data: 'cut' };
const mark = { nodeType: 1, childNodes: [tc] };
const t2 = { nodeType: 3, data: ' keep' };
const p = { nodeType: 1, childNodes: [t1, mark, t2] }; // textContent === "keep cut keep"

// instantiate the shipped function against our faithful document
const offsetInPara = (0, eval)('(' + m[0] + ')');
globalThis.document = makeDocument();

// ── the OLD text-walk, as a runnable mutation oracle ──────────────────────────
function oldOffsetInPara(p, node, nodeOffset) {
  let seen = 0;
  const texts = [];
  (function collect(n) { if (n.nodeType === 3) texts.push(n); else (n.childNodes || []).forEach(collect); })(p);
  for (const t of texts) { if (t === node) return seen + nodeOffset; seen += t.data.length; }
  return -1;
}

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); pass++; };

// 1. TEXT container mid-word — the case the old walk already handled. Both agree.
eq(offsetInPara(p, t1, 3), 3, 'text container: offset into "keep " → 3');
eq(oldOffsetInPara(p, t1, 3), 3, 'old walk also gets the text-container case (baseline: this was never the bug)');

// 2. THE BUG — <p> ELEMENT container at child-index 1 (the <mark> boundary).
//    New: "keep " → 5. Old: -1 (never matched an element container).
eq(offsetInPara(p, p, 1), 5, 'element <p> container @ index 1 → 5 ("keep ")');
eq(oldOffsetInPara(p, p, 1), -1, 'MUTATION PROOF: old text-walk returns -1 on the <p> element container — the iPad decay bug');

// 3. <p> element container at child-index 2 (after the mark). New: "keep cut" → 8. Old: -1.
eq(offsetInPara(p, p, 2), 8, 'element <p> container @ index 2 → 8 ("keep cut")');
eq(oldOffsetInPara(p, p, 2), -1, 'MUTATION PROOF: old walk still -1 past the mark');

// 4. <mark> ELEMENT container with a child-index offset. New: before-mark + inner = 8. Old: -1.
eq(offsetInPara(p, mark, 1), 8, 'element <mark> container @ index 1 → 8 ("keep " + "cut")');
eq(oldOffsetInPara(p, mark, 1), -1, 'MUTATION PROOF: old walk -1 on a <mark> element container');

// 5. TEXT container INSIDE a mark — both forms agree (text node matched directly).
eq(offsetInPara(p, tc, 2), 7, 'text inside <mark>: "keep " + "cu" → 7');
eq(oldOffsetInPara(p, tc, 2), 7, 'old walk agrees on the in-mark text container');

// 6. end-of-paragraph text container — full prefix.
eq(offsetInPara(p, t2, 5), 13, 'trailing text container @ end → 13 (whole "keep cut keep")');

// 7. the try/catch degrades to -1 on a bad container (never NaN/throw).
eq(offsetInPara(p, null, 0), -1, 'null container is caught → -1 (never throws)');

// ── SOURCE LOCK on the SECOND half of the fix: the mark-tap guard ─────────────
// The click handler must only open the note sheet on a REAL collapsed tap
// (>=400ms since the last selection collapse), never as the tail of a word-select
// that happened to land on a highlight. Lock the guard so the pre-fix
// "any tap on a mark opens the sheet" form can't silently return.
const clickBlock = html.match(/const m = e\.target\.closest\('mark'\);[\s\S]*?openSheet\(n\)/);
assert.ok(clickBlock, 'could not locate the mark-tap click branch');
ok(/isCollapsed/.test(clickBlock[0]), 'mark-tap opens the sheet only when the selection isCollapsed');
ok(/lastSelCollapse\s*>=\s*400/.test(clickBlock[0]),
  'mark-tap requires >=400ms since the last selection collapse (not a word-select tail)');
// the openSheet call must sit INSIDE the guard, not directly under `if (m) {`
const guardIdx = clickBlock[0].search(/isCollapsed/);
const openIdx = clickBlock[0].search(/openSheet\(n\)/);
ok(guardIdx > -1 && guardIdx < openIdx, 'the isCollapsed/400ms guard precedes openSheet — the tap is gated');

console.log(`offset-in-para.test.mjs: ${pass} assertions passed`);
