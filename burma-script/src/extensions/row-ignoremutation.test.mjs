/*
 * row-ignoremutation.test.mjs — the tableRow nodeView's ignoreMutation contract
 * (editor-ergonomics live-pass fix e3fcf898, NARROWED by the review fix 2026-07-21).
 *
 * THE INCIDENT PAIR this pins, in both directions:
 *   • FLICKER (e3fcf898's original bug): the drag system's wp-drop-before/after +
 *     wp-trow-dragging CLASS flips on the row's own dom must be IGNORED — left unignored,
 *     every indicator paint read as a real mutation → PM re-rendered the nodeView → the
 *     fresh dom wiped the class → re-paint → a teardown loop on every drag frame.
 *   • SELECTION COLLAPSE (the review BLOCKER): Editor.jsx's paintActiveSelectionWrappers
 *     raw-writes data-pm-active-selection onto the row dom from OUTSIDE PM's update cycle
 *     on every selectionUpdate. When e3fcf898 swallowed ALL attribute mutations on the row
 *     dom, PM's DOMObserver flush treated the batch as selection-only and re-synced the
 *     native selection from stale state mid-gesture — a cross-row mouse-drag selection
 *     deterministically collapsed at the row boundary, and the select→right-click bulk
 *     menu (which refuses on an empty selection) died with it.
 *
 * The contract: on the row's OWN dom, ignore CLASS flips ONLY; every other attribute flip
 * (data-pm-active-selection above all) must reach ProseMirror. Chrome subtrees (drag grip,
 * add-row button, merge/split chips) stay fully ignored; content mutations never are.
 *
 * Proves:
 *   1. class flip on the row dom → IGNORED (flicker fix retained).
 *   2. data-pm-active-selection flip on the row dom → NOT ignored (selection painter's
 *      writes reach PM — the collapse vector is closed).
 *   3. any other non-class attr on the row dom (data-cols et al.) → NOT ignored
 *      (pre-e3fcf898 processing restored for painted attrs).
 *   4. childList / characterData on the row dom or content subtree → NOT ignored.
 *   5. chrome subtrees (wp-row-drag grip, wp-row-add, wp-row-colmerge, wp-row-colsplit)
 *      → IGNORED wholesale, including nested descendants and non-class attrs.
 *
 * Run: bun src/extensions/row-ignoremutation.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';

// ── minimal DOM stub (menu-kbd.test.mjs convention — no jsdom) ──────────────────────────────
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = '';
    this.children = [];
    this.parent = null;
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.classList = {
      add: (c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); s.add(c); this.className = [...s].join(' '); },
      remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      contains: (c) => this.className.split(/\s+/).includes(c),
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  contains(other) {
    if (other === this) return true;
    return this.children.some((c) => c.contains(other));
  }
  // find a descendant by class name (test helper)
  find(cls) {
    for (const c of this.children) {
      if ((c.className || '').split(/\s+/).includes(cls)) return c;
      const hit = c.find(cls);
      if (hit) return hit;
    }
    return null;
  }
}
globalThis.document = {
  createElement: (t) => new El(t),
  documentElement: new El('html'),   // prosemirror-view sniffs .style at import time
};

const { getSchema } = await import('@tiptap/core');
const { Node: PMNode } = await import('@tiptap/pm/model');
const StarterKit = (await import('@tiptap/starter-kit')).default;
const Dropcursor = (await import('@tiptap/extension-dropcursor')).default;
const Gapcursor = (await import('@tiptap/extension-gapcursor')).default;
const { TableRow, BURMA_TABLE_NODES } = await import('./table.js');
const { BURMA_NODES } = await import('./blocks.js');
const { BURMA_MARKS } = await import('./marks.js');
const { DirectionMark } = await import('./direction-chip.js');
const { setEpisode } = await import('../episode-config.js');
const { BURMA } = await import('../../config.js');

setEpisode(BURMA);   // Burma ships rowDragReorder → the grip chrome mounts

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, strike: false, dropcursor: false, gapcursor: false,
    history: { depth: 100, newGroupDelay: 750 },
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const rowNode = PMNode.fromJSON(schema, {
  type: 'tableRow', attrs: { cols: 1, pairId: null },
  content: [{
    type: 'tableCell', attrs: { role: 'full' },
    content: [{ type: 'noneBlock', attrs: { blockId: 'blk_a' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] }] }],
  }],
});

// Instantiate the REAL nodeView (editor/getPos only feed event handlers, never the build).
const factory = TableRow.config.addNodeView();
const nv = factory({ node: rowNode, editor: { view: { editable: true } }, getPos: () => 0 });
const dom = nv.dom;
const content = nv.contentDOM;

const attrMut = (target, attributeName) => ({ type: 'attributes', target, attributeName });

// ── 1. CLASS flips on the row dom are chrome paint → IGNORED (the flicker fix) ───────────────
ok('class flip on row dom IGNORED — drop-indicator/dragging paint never re-renders the view', () => {
  assert.equal(nv.ignoreMutation(attrMut(dom, 'class')), true);
});

// ── 2. data-pm-active-selection MUST reach PM (the selection-collapse BLOCKER) ───────────────
ok('data-pm-active-selection flip on row dom NOT ignored — cross-row drag-select survives', () => {
  assert.ok(!nv.ignoreMutation(attrMut(dom, 'data-pm-active-selection')));
});

// ── 3. every other non-class attr on the row dom → NOT ignored (pre-e3fcf898 behavior) ───────
ok('non-class attrs on row dom NOT ignored (data-cols / data-pair-id / data-bookmark-id / arbitrary)', () => {
  for (const a of ['data-cols', 'data-pair-id', 'data-bookmark-id', 'data-anything-future']) {
    assert.ok(!nv.ignoreMutation(attrMut(dom, a)), `${a} must NOT be swallowed`);
  }
});

// ── 4. content mutations are never ignored ───────────────────────────────────────────────────
ok('childList/characterData on row dom + content subtree NOT ignored', () => {
  assert.ok(!nv.ignoreMutation({ type: 'childList', target: dom }));
  assert.ok(!nv.ignoreMutation({ type: 'childList', target: content }));
  assert.ok(!nv.ignoreMutation({ type: 'characterData', target: content }));
  // even a CLASS flip below the row dom itself (e.g. on a cell) is not the row-dom carve-out
  const cell = new El('div');
  content.appendChild(cell);
  assert.ok(!nv.ignoreMutation(attrMut(cell, 'class')));
});

// ── 5. chrome subtrees stay wholesale-ignored (grip, add button, merge/split chips) ──────────
ok('chrome subtrees IGNORED: wp-row-drag / wp-row-add / wp-row-colmerge / wp-row-colsplit', () => {
  for (const cls of ['wp-row-drag', 'wp-row-add', 'wp-row-colmerge', 'wp-row-colsplit']) {
    const chrome = dom.find(cls);
    assert.ok(chrome, `${cls} chrome mounted (writable non-read session)`);
    assert.equal(nv.ignoreMutation(attrMut(chrome, 'data-whatever')), true, `${cls} root ignored`);
    assert.equal(nv.ignoreMutation({ type: 'childList', target: chrome }), true, `${cls} childList ignored`);
    const nested = new El('span');
    chrome.appendChild(nested);
    assert.equal(nv.ignoreMutation(attrMut(nested, 'class')), true, `${cls} descendant ignored`);
  }
});

console.log(`row-ignoremutation: ${pass} tests passed`);
