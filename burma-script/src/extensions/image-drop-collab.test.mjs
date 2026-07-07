/*
 * image-drop-collab.test.mjs — locks the enterprise-audit HIGH: "every remote keystroke destroys
 * the image-upload placeholder — image drop always aborts under active collab." A y-sync apply
 * lands as a FULL-DOC replace (COLLAB LOOP LAW), and DecorationSet.map drops widgets inside a
 * replaced range. The fix rebuilds placeholders from injected relative anchors on remote
 * transactions (setImageDropCollabAnchors, armed by collab-runtime.js with real Yjs relative
 * positions). This test drives the production plugin with a STUB adapter — the plugin's contract
 * is adapter-shape-agnostic, so the rebuild/prune/abort logic is provable without a Yjs room.
 * The REAL adapter's toRel/toAbs are y-tiptap's own relative-position functions (the mechanism
 * collab carets ride), exercised by the 2-browser live collab check per the incident law.
 *
 * Run: bun src/extensions/image-drop-collab.test.mjs
 */
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { Slice } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import {
  addPlaceholderTr, findPlaceholderPos, buildImageDropPlugin, setImageDropCollabAnchors,
} from './image-drop.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

// A plain-paragraph schema is enough: the plugin's decoration state logic is schema-agnostic
// (legality of the final insert is a separate, already-tested concern).
const schema = getSchema([StarterKit]);
const REMOTE = 'stub-remote';

function freshState() {
  return EditorState.create({
    schema,
    doc: schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'row one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'row two' }] },
      ],
    }),
    plugins: [buildImageDropPlugin()],
  });
}

// Simulate what the y-sync binding does on ANY remote change: replace the whole doc content.
function fullDocReplaceTr(state, remote) {
  const tr = state.tr.replace(0, state.doc.content.size, new Slice(state.doc.content, 0, 0));
  if (remote) tr.setMeta(REMOTE, true);
  return tr;
}

// The stub: anchors remember the pos they were created at; toAbs replays it (a real Yjs
// relative position resolves to wherever the anchored item lives in the NEW doc).
function stubAdapter({ absOverride } = {}) {
  return {
    isRemote: (tr) => !!tr.getMeta(REMOTE),
    toRel: (state, pos) => ({ pos }),
    toAbs: (state, anchor) => (absOverride === undefined ? anchor.pos : absOverride),
  };
}

try {
  ok('WITHOUT adapter (non-collab), a full-doc replace kills the placeholder — the audited bug shape', () => {
    setImageDropCollabAnchors(null);
    let state = freshState();
    state = state.apply(addPlaceholderTr(state, 3, 'img_a'));
    assert.equal(findPlaceholderPos(state, 'img_a'), 3);
    state = state.apply(fullDocReplaceTr(state, true));
    assert.equal(findPlaceholderPos(state, 'img_a'), null, 'widget dropped by numeric mapping');
  });

  ok('WITH adapter, the placeholder SURVIVES a remote full-doc replace (rebuilt from its anchor)', () => {
    setImageDropCollabAnchors(stubAdapter());
    let state = freshState();
    state = state.apply(addPlaceholderTr(state, 3, 'img_b'));
    state = state.apply(fullDocReplaceTr(state, true));
    assert.equal(findPlaceholderPos(state, 'img_b'), 3, 'rebuilt at the anchor-resolved position');
    // And again — every subsequent remote keystroke is another full-doc replace.
    state = state.apply(fullDocReplaceTr(state, true));
    assert.equal(findPlaceholderPos(state, 'img_b'), 3);
  });

  ok('anchor that no longer resolves (site deleted remotely) drops the placeholder → insert aborts', () => {
    setImageDropCollabAnchors(stubAdapter({ absOverride: null }));
    let state = freshState();
    state = state.apply(addPlaceholderTr(state, 3, 'img_c'));
    state = state.apply(fullDocReplaceTr(state, true));
    assert.equal(findPlaceholderPos(state, 'img_c'), null, 'null anchor = abort, never clamp');
  });

  ok('LOCAL deletion prunes the anchor — a later remote echo cannot resurrect the placeholder', () => {
    setImageDropCollabAnchors(stubAdapter());
    let state = freshState();
    state = state.apply(addPlaceholderTr(state, 3, 'img_d'));
    // Local edit deletes the placeholder's range (numeric mapping drops the widget).
    state = state.apply(state.tr.delete(1, 8));
    assert.equal(findPlaceholderPos(state, 'img_d'), null);
    // Remote echo arrives — the pruned anchor must NOT bring the widget back.
    state = state.apply(fullDocReplaceTr(state, true));
    assert.equal(findPlaceholderPos(state, 'img_d'), null, 'stayed dead after prune');
  });

  ok('local transactions still map placeholders numerically with the adapter armed', () => {
    setImageDropCollabAnchors(stubAdapter());
    let state = freshState();
    state = state.apply(addPlaceholderTr(state, 10, 'img_e'));
    state = state.apply(state.tr.insertText('xxx', 1)); // local edit above shifts by 3
    assert.equal(findPlaceholderPos(state, 'img_e'), 13);
  });
} finally {
  setImageDropCollabAnchors(null); // module-level registry — never leak into other suites
}

console.log('image-drop-collab: ' + pass + '/5 passed');
