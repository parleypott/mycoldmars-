/*
 * media-click-race.test.mjs — the IMAGE / GIF / VIDEO click-to-select INVARIANT (the focus race).
 *
 * Johnny 2026-07-24 (live regression): "i cant click gifs or videos — i click and it tweaks out
 * and I see the bounding box but then it all deselects." Classic focus-race fingerprint ("first
 * click flickers, second holds"). The imageBlock nodeview's authoritative-mousedown fix (blocks.js,
 * 2026-07-22) synchronously focuses the view + sets a NodeSelection on the media atom BEFORE the
 * browser's focus-driven DOM placement can clobber it. Two ways that fix was being defeated:
 *
 *   ROOT CAUSE (gif/video-specific): the handler was bound to the SWAPPABLE `media` element. paint()
 *   REPLACES `media` on an image↔video src flip — a gif transcodes to mp4, and a freshly-dropped
 *   video lands as an uploading:true placeholder that renders as an <img> first, then the upload
 *   swaps in the .mp4 and the element becomes a <video>. The swap re-bound only
 *   load/loadedmetadata/timeupdate, so the authoritative mousedown was SILENTLY LOST on the new
 *   <video> and gif/video clicks fell back to the native (racy) path. Static images never swap
 *   element type, so they kept working — the exact gif/video-only symptom. FIX: bind on the stable
 *   figure `dom`, gate on `e.target === media`.
 *
 *   RACE CLASS (all media): today's new mousedown-adding plugins (columnSelectPlugin, rowPlacement)
 *   raise the ambient pressure of the focus transition. This suite locks the INVARIANT the task
 *   demands: a media NodeSelection must SURVIVE the full mousedown cycle with ALL of today's plugins
 *   mounted — so any FUTURE mousedown-adding plugin that clobbers a media selection fails here.
 *
 * The headless reality (repo memory reference_headless_cannot_unfocus_document): a real browser
 * FOCUS TRANSITION cannot be reproduced headless, so this suite does NOT try to. It drives the REAL
 * plugin handlers (not stand-ins) against a state that already holds a media NodeSelection and proves
 * they are INERT on a media target — never dispatch, never move the selection — which is the exact
 * property that keeps the authoritative frame alive through the race.
 *
 * Proves:
 *   1. columnSelectPlugin.onMouseDown on a <video> (.wp-image-img inside .wp-image) dispatches
 *      NOTHING and leaves the media NodeSelection byte-identical — even with a LIVE column scope
 *      already engaged (the case where its setScope(null) WOULD otherwise dispatch).
 *   2. dragSourceSanctioned(video) === true (the structural bail the above relies on).
 *   3. rowPlacement.handleDOMEvents.mousedown is inert (returns false, zero dispatch) when idle.
 *   4. SOURCE INVARIANT: the imageBlock nodeview binds its authoritative mousedown (and dblclick) on
 *      the stable figure `dom` gated on `e.target === media`, NOT on the swappable `media` element —
 *      so an image↔video swap can never strip the handler again.
 *
 * Run: bun src/extensions/media-click-race.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── minimal DOM stub (row-ignoremutation.test.mjs convention — no jsdom) ─────────────────────
// prosemirror-view sniffs document.documentElement.style at import; the plugin views attach
// listeners to editorView.dom + document. Nothing here needs layout — only listener capture and a
// closest() that walks the parent chain for class/attr selectors.
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.className = '';
    this.attrs = {};
    this.style = {};
    this.parentNode = null;
    this.children = [];
    this.listeners = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null; } }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { const a = this.listeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  matches(sel) {
    return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((tok) => {
      if (tok[0] === '.') return this.className.split(/\s+/).includes(tok.slice(1));
      if (tok[0] === '[') { const name = tok.slice(1, -1).split('=')[0]; return name in this.attrs; }
      return false;
    });
  }
  closest(sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; }
}
globalThis.document = globalThis.document || {
  createElement: (t) => new El(t),
  documentElement: new El('html'),
  body: new El('body'),
  addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };

const { getSchema } = await import('@tiptap/core');
const { Node: PMNode } = await import('@tiptap/pm/model');
const { EditorState, NodeSelection } = await import('@tiptap/pm/state');
const StarterKit = (await import('@tiptap/starter-kit')).default;
const Dropcursor = (await import('@tiptap/extension-dropcursor')).default;
const Gapcursor = (await import('@tiptap/extension-gapcursor')).default;
const { BURMA_TABLE_NODES, columnSelectPlugin, columnSelectEnabled, dragSourceSanctioned, colSelectKey } = await import('./table.js');
const { BURMA_NODES } = await import('./blocks.js');
const { BURMA_MARKS } = await import('./marks.js');
const { DirectionMark } = await import('./direction-chip.js');
const { RowPlacement } = await import('./row-placement.js');
const { setEpisode } = await import('../episode-config.js');
const { __setReadOnlyForTest } = await import('../read-mode.js');
const { BURMA } = await import('../../config.js');

setEpisode(BURMA);
__setReadOnlyForTest(false);   // both plugins mount only in an EDIT session

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

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

// A doc whose single full-width row's cell holds a VIDEO imageBlock (a gif/video atom).
const doc = PMNode.fromJSON(schema, {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null, bookmarkId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{ type: 'imageBlock', attrs: { src: 'https://cdn.example/clip.mp4', blockId: 'vid1' } }],
    }],
  }],
});
let imgPos = null;
doc.descendants((n, p) => { if (n.type.name === 'imageBlock') imgPos = p; });
assert.equal(typeof imgPos, 'number', 'located the imageBlock');

// The DOM target a real click lands on: <video class="wp-image-img"> inside <figure class="wp-image">.
const figure = new El('figure'); figure.className = 'wp-image';
const videoEl = new El('video'); videoEl.className = 'wp-image-img';
figure.appendChild(videoEl);

// The REAL plugins, in one state so each plugin's getState() resolves.
const colPlugin = columnSelectPlugin();
const [rpPlugin] = RowPlacement.config.addProseMirrorPlugins();
assert.ok(rpPlugin, 'rowPlacement mounts a plugin in an edit session');

function freshView(withScope) {
  let state = EditorState.create({
    schema, doc, plugins: [colPlugin, rpPlugin],
    selection: NodeSelection.create(doc, imgPos),
  });
  const dispatched = [];
  const view = {
    dom: new El('div'),
    get state() { return state; },
    dispatch(tr) { dispatched.push(tr); state = state.apply(tr); },
    posAtCoords() { return null; },
    hasFocus() { return true; },
    focus() {},
    editable: true,
  };
  // Optionally pre-engage a LIVE column scope so columnSelect's setScope(null) has something to
  // clear — the case that would DISPATCH on a media mousedown if the sanctioned-bail weren't first.
  if (withScope) {
    view.dispatch(state.tr.setMeta(colSelectKey, { role: 'said' }));
    dispatched.length = 0;   // don't count the setup dispatch
    assert.equal(colSelectKey.getState(view.state).role, 'said', 'scope engaged for the test');
    // selection is still the NodeSelection (setMeta never moves it)
    assert.ok(view.state.selection instanceof NodeSelection, 'scope setup kept the NodeSelection');
  }
  return { view, dispatched, getSel: () => view.state.selection };
}

// ── 1. columnSelect onMouseDown on a media target: zero dispatch, selection survives ──────────
ok('columnSelect mousedown on a <video> dispatches nothing and keeps the media NodeSelection', () => {
  assert.equal(columnSelectEnabled(), true, 'edit session — the gesture is mounted');
  for (const withScope of [false, true]) {
    const { view, dispatched, getSel } = freshView(withScope);
    const pluginView = colPlugin.spec.view(view);   // attaches onMouseDown to view.dom
    const onMouseDown = (view.dom.listeners.mousedown || [])[0];
    assert.equal(typeof onMouseDown, 'function', 'columnSelect attached its mousedown');
    onMouseDown({ button: 0, target: videoEl, clientX: 12, clientY: 12,
      preventDefault() {}, stopPropagation() {} });
    assert.equal(dispatched.length, 0,
      `media mousedown must not dispatch (withScope=${withScope}) — no scope-clear during the focus race`);
    const sel = getSel();
    assert.ok(sel instanceof NodeSelection && sel.from === imgPos,
      `the media NodeSelection survives the columnSelect mousedown (withScope=${withScope})`);
    try { pluginView && pluginView.destroy && pluginView.destroy(); } catch {}
  }
});

// ── 2. the structural bail the above relies on ────────────────────────────────────────────────
ok('dragSourceSanctioned(video) is true — closest(.wp-image) sanctions the media target', () => {
  assert.equal(dragSourceSanctioned(videoEl), true);
  const plainCell = new El('div'); plainCell.className = 'wp-tcell';
  assert.equal(dragSourceSanctioned(plainCell), false, 'a plain cell is NOT sanctioned (native gesture)');
});

// ── 3. rowPlacement mousedown is inert when idle (no placement session) ───────────────────────
ok('rowPlacement mousedown returns false + zero dispatch when off-placement', () => {
  const { view, dispatched, getSel } = freshView(false);
  const md = rpPlugin.spec.props.handleDOMEvents.mousedown;
  let prevented = false;
  const ret = md(view, { target: videoEl, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(ret, false, 'idle rowPlacement lets the event through');
  assert.equal(prevented, false, 'idle rowPlacement never preventDefaults a media click');
  assert.equal(dispatched.length, 0, 'idle rowPlacement dispatches nothing');
  assert.ok(getSel() instanceof NodeSelection, 'the media NodeSelection is untouched');
});

// ── 4. SOURCE INVARIANT — the authoritative handler binds on the stable figure, not media ──────
// A future refactor that re-binds the media selection on the swappable element (re-introducing the
// gif/video swap-loss) trips this. Structural because the giant imageBlock nodeview isn't headless-
// mountable in this repo (no jsdom) — but the binding surface is the whole fix, so it's worth a lock.
ok('imageBlock authoritative mousedown/dblclick bind on `dom`, gated on e.target === media', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'blocks.js'), 'utf8');
  // The fragile pattern (handler on the swappable element) must be GONE for mousedown + dblclick.
  assert.equal(/media\.addEventListener\(\s*['"]mousedown['"]/.test(src), false,
    'mousedown must NOT bind on the swappable `media` element');
  assert.equal(/media\.addEventListener\(\s*['"]dblclick['"]/.test(src), false,
    'dblclick must NOT bind on the swappable `media` element');
  // The swap-proof pattern must be PRESENT: bound on `dom`, gated on the current media target.
  assert.ok(/dom\.addEventListener\(\s*['"]mousedown['"]/.test(src),
    'mousedown binds on the stable figure `dom`');
  assert.ok(/dom\.addEventListener\(\s*['"]dblclick['"]/.test(src),
    'dblclick binds on the stable figure `dom`');
  assert.ok(/e\.target\s*!==\s*media/.test(src),
    'the figure handlers gate on `e.target === media` so they stay media-only');
});

console.log(`media-click-race.test.mjs: ${pass} assertions passed`);
