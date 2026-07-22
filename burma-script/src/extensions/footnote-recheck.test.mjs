/*
 * footnote-recheck.test.mjs — the RECHECK button's client path (extensions/footnote.js
 * createFootnotePanel → mode:'quote' fetch → receipt merge → flush-to-doc).
 *
 * The API side of mode:'quote' is locked (api/burma-tk.test.mjs), but the CLIENT half —
 * what claim gets sent, how the returned verbatim quotes land in the Context field, how new
 * URLs append to Source without duplicating, and how the merge is FLUSHED into the doc node
 * (never stranded in the panel) — shipped with zero coverage. A regression here silently
 * drops or duplicates fact-check receipts on Johnny's live script.
 *
 * This suite mounts the REAL FcFootnote nodeView + fly-out on a minimal DOM stub (bun has no
 * DOM), with a REAL EditorState dispatch loop underneath, and drives the shipped listener.
 *
 * Proves:
 *   1. PAYLOAD CONTRACT — RECHECK POSTs the episode's tkApi with mode:'quote', the stored
 *      marker as the claim (lineage first), the surrounding block prose, and note+source as
 *      context (the exact shape api/burma-tk.js buildPayload consumes).
 *   2. RECEIPT MERGE — finding + “quote” — source lines append to the Context field, new
 *      source URLs append to Source, the verdict lands, and ALL of it is flushed into the
 *      fcFootnote node attrs on the doc (survives autosave/collab/recovery from that moment).
 *   3. URL DEDUPE — a returned URL already present in Source is NOT appended again.
 *   4. TIMEOUT WORDING — a 504 with a non-JSON body surfaces the human timeout line
 *      ('the recheck timed out — try again') and leaves the doc attrs untouched.
 *   5. EMPTY-CLAIM GUARD — no marker, no preceding prose, no context ⇒ the 'nothing to
 *      check yet' message and NO network call.
 *
 * Run: bun src/extensions/footnote-recheck.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';

// ── minimal DOM stub (installed BEFORE the extension modules run any DOM code) ─────────────
function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: '',
    children: [],
    parentNode: null,
    style: {},
    value: '',
    textContent: '',
    _innerHTML: '',
    attrs: {},
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    remove() {
      if (!this.parentNode) return;
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const a = this.listeners[type];
      if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
    },
    contains(other) { let n = other; while (n) { if (n === this) return true; n = n.parentNode; } return false; },
    getBoundingClientRect() { return { top: 20, left: 20, right: 40, bottom: 40, width: 320, height: 200 }; },
    focus() {}, blur() {},
  };
  node.classList = {
    add() {}, remove() {}, toggle() {}, contains() { return false; },
  };
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._innerHTML; },
    set(v) { this._innerHTML = String(v); },
  });
  return node;
}

const documentStub = {
  createElement: (t) => makeEl(t),
  body: makeEl('body'),
  documentElement: makeEl('html'), // prosemirror-view sniffs .style at import time
  addEventListener() {}, removeEventListener() {},
};
globalThis.document = documentStub;
globalThis.window = {
  innerWidth: 1400, innerHeight: 900,
  addEventListener() {}, removeEventListener() {},
};
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };

const { getSchema } = await import('@tiptap/core');
const { Node: PMNode } = await import('@tiptap/pm/model');
const { EditorState } = await import('@tiptap/pm/state');
const StarterKit = (await import('@tiptap/starter-kit')).default;
const Dropcursor = (await import('@tiptap/extension-dropcursor')).default;
const Gapcursor = (await import('@tiptap/extension-gapcursor')).default;
const { FcFootnote, closeOpenFootnotePanel } = await import('./footnote.js');
const { BURMA_NODES } = await import('./blocks.js');
const { BURMA_TABLE_NODES } = await import('./table.js');
const { BURMA_MARKS } = await import('./marks.js');
const { DirectionMark } = await import('./direction-chip.js');
const { setEpisode } = await import('../episode-config.js');
const { BURMA } = await import('../../config.js');

setEpisode(BURMA);

let pass = 0;
const ok = (label, fn) => fn();
const done = () => pass++;

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
  DirectionMark,
]);

const FN_ATTRS = {
  noteId: 'fn_test1',
  note: 'checked once against the census law',
  source: 'https://old.example/report',
  marker: 'Myanmar officially recognizes 135 ethnic groups',
  verdict: '',
};
const docJson = {
  type: 'doc',
  content: [{
    type: 'tableRow', attrs: { cols: 1, pairId: null },
    content: [{
      type: 'tableCell', attrs: { role: 'full' },
      content: [{
        type: 'noneBlock', attrs: { blockId: 'blk_fn' },
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'The junta counts its peoples: ' },
            { type: 'fcFootnote', attrs: FN_ATTRS },
          ],
        }],
      }],
    }],
  }],
};

// REAL state + dispatch loop under a stub editor — flush() lands on this doc for real.
let state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, docJson) });
const editor = {
  get state() { return state; },
  view: { dispatch(tr) { state = state.apply(tr); }, focus() {} },
};
let fnPos = null;
state.doc.descendants((n, p) => { if (n.type.name === 'fcFootnote') fnPos = p; });
assert.ok(typeof fnPos === 'number', 'test doc holds the footnote');

const findAll = (root, cls, out = []) => {
  if (String(root.className || '').split(/\s+/).includes(cls)) out.push(root);
  for (const c of root.children || []) findAll(c, cls, out);
  return out;
};
const fakeEvt = () => ({ preventDefault() {}, stopPropagation() {}, target: null });

// Mount the REAL nodeView and open the REAL panel through its shipped mousedown listener.
const renderNodeView = FcFootnote.config.addNodeView.call({});
const openPanel = (getPos) => {
  const nv = renderNodeView({ editor, getPos });
  nv.dom.listeners.mousedown[0](fakeEvt());
  const panel = documentStub.body.children[documentStub.body.children.length - 1];
  assert.ok(panel && findAll(panel, 'wp-fnote-badge').length, 'fly-out mounted');
  return panel;
};

// fetch spy
let fetchCalls = [];
let fetchImpl = null;
globalThis.fetch = async (url, opts) => { fetchCalls.push({ url, opts }); return fetchImpl(url, opts); };

// ── 1 + 2 + 3: happy path — payload contract, receipt merge, flush-to-doc, URL dedupe ──────
{
  fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({
      mode: 'quote', verdict: 'true',
      finding: 'The 135 figure traces to the 1982 citizenship framework.',
      quotes: [
        { quote: 'The government officially recognizes 135 ethnic groups', source: 'BBC, 2017', url: 'https://bbc.example/135-groups' },
        { quote: 'the list of 135 national races', source: 'HRW report', url: 'https://old.example/report' }, // url ALREADY in Source
      ],
    }),
  });

  const panel = openPanel(() => fnPos);
  // 2026-07-07 redesign: the CONTEXT textarea is gone — the note renders as the BLURB (the
  // verbatim quote is the main content; double-click swaps in the hidden editor textarea).
  const blurb = findAll(panel, 'wp-fnote-blurb')[0];
  const src = findAll(panel, 'wp-fnote-src')[0];
  const reBtn = findAll(panel, 'wp-fnote-recheck').find((n) => n.tagName === 'BUTTON');
  assert.ok(blurb && src && reBtn, 'panel exposes blurb, source and RECHECK');
  assert.equal(blurb.textContent, FN_ATTRS.note, 'panel opens with the stored note as the blurb');

  await reBtn.listeners.mousedown[0](fakeEvt());

  // payload contract (what api/burma-tk.js buildPayload consumes)
  assert.equal(fetchCalls.length, 1, 'exactly one recheck call');
  assert.equal(fetchCalls[0].url, BURMA.cloud.tkApi, 'hits the episode-pinned tk endpoint');
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.equal(body.mode, 'quote');
  assert.equal(body.marker, FN_ATTRS.marker, 'the stored marker IS the claim (lineage first)');
  assert.ok(body.block.includes('The junta counts its peoples:'), 'surrounding block prose rides along');
  assert.ok(body.context.includes(FN_ATTRS.note) && body.context.includes(FN_ATTRS.source),
    'existing note + source travel as context');

  // receipt merge — the blurb re-renders with the appended receipt
  assert.ok(blurb.textContent.includes('The 135 figure traces to the 1982 citizenship framework.'), 'finding lands first');
  assert.ok(blurb.textContent.includes('“The government officially recognizes 135 ethnic groups” — BBC, 2017'),
    'verbatim quote + attribution land in the blurb');
  assert.ok(blurb.textContent.startsWith(FN_ATTRS.note), 'existing note is APPENDED to, never replaced');

  // flush-to-doc — the receipt is on the NODE, not stranded in the panel
  const attrs = state.doc.nodeAt(fnPos).attrs;
  assert.ok(attrs.note.includes('BBC, 2017'), 'note flushed into the doc node');
  assert.ok(attrs.source.includes('https://bbc.example/135-groups'), 'NEW url appended to Source');
  assert.equal(attrs.source.split('https://old.example/report').length - 1, 1,
    'already-present url NOT duplicated (dedupe)');
  assert.equal(attrs.verdict, 'true', 'verdict flushed');
  assert.equal(reBtn.textContent, 'RECHECK', 'button label restored after the run');

  closeOpenFootnotePanel();
  done();
}

// ── 4: 504 / non-JSON body → the human timeout line, doc untouched ─────────────────────────
{
  const attrsBefore = JSON.stringify(state.doc.nodeAt(fnPos).attrs);
  fetchImpl = async () => ({ ok: false, status: 504, text: async () => 'upstream timeout page (html)' });
  fetchCalls = [];

  const panel = openPanel(() => fnPos);
  const reBtn = findAll(panel, 'wp-fnote-recheck').find((n) => n.tagName === 'BUTTON');
  const reErr = findAll(panel, 'wp-fnote-recheck-err')[0];
  await reBtn.listeners.mousedown[0](fakeEvt());

  assert.equal(fetchCalls.length, 1);
  assert.equal(reErr.textContent, 'the recheck timed out — try again', 'timeout wording surfaced');
  assert.equal(JSON.stringify(state.doc.nodeAt(fnPos).attrs), attrsBefore, 'doc attrs untouched on failure');
  assert.equal(reBtn.textContent, 'RECHECK');

  closeOpenFootnotePanel();
  done();
}

// ── 5: empty claim → guard message, NO network ─────────────────────────────────────────────
{
  const bareDoc = {
    type: 'doc',
    content: [{
      type: 'tableRow', attrs: { cols: 1, pairId: null },
      content: [{
        type: 'tableCell', attrs: { role: 'full' },
        content: [{
          type: 'noneBlock', attrs: { blockId: 'blk_bare' },
          content: [{
            type: 'paragraph',
            content: [{ type: 'fcFootnote', attrs: { noteId: 'fn_bare', note: '', source: '', marker: '', verdict: '' } }],
          }],
        }],
      }],
    }],
  };
  state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, bareDoc) });
  let barePos = null;
  state.doc.descendants((n, p) => { if (n.type.name === 'fcFootnote') barePos = p; });
  fetchCalls = [];
  fetchImpl = async () => { throw new Error('must not be called'); };

  const panel = openPanel(() => barePos);
  const reBtn = findAll(panel, 'wp-fnote-recheck').find((n) => n.tagName === 'BUTTON');
  const reErr = findAll(panel, 'wp-fnote-recheck-err')[0];
  await reBtn.listeners.mousedown[0](fakeEvt());

  assert.equal(fetchCalls.length, 0, 'no network call without a claim');
  assert.ok(reErr.textContent.startsWith('nothing to check yet'), 'guard message shown');

  closeOpenFootnotePanel();
  done();
}

console.log(`footnote-recheck.test.mjs: ${pass} scenarios passed (payload contract, receipt merge + flush, dedupe, timeout wording, empty-claim guard)`);
