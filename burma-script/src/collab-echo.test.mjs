// collab-echo.test.mjs — locks the y-sync echo discrimination (enterprise-audit PERF finding:
// remote keystrokes drove this tab's 300ms save loop all session). Run: bun src/collab-echo.test.mjs

import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { isRemoteEchoTransaction } from './collab-echo.js';

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓ ' + label); };

const schema = getSchema([StarterKit]);
const state = EditorState.create({ schema });
const tr = () => state.tr.insertText('x', 1);

ok('remote teammate edit (isChangeOrigin, no undo flag) IS an echo', () => {
  assert.equal(isRemoteEchoTransaction(tr().setMeta(ySyncPluginKey, { isChangeOrigin: true })), true);
});

ok('local undo/redo (isChangeOrigin + isUndoRedoOperation) is NOT an echo — it must keep saving', () => {
  assert.equal(
    isRemoteEchoTransaction(tr().setMeta(ySyncPluginKey, { isChangeOrigin: true, isUndoRedoOperation: true })),
    false,
  );
});

ok('local typing (no ySync meta) is NOT an echo', () => {
  assert.equal(isRemoteEchoTransaction(tr()), false);
});

ok('degenerate inputs never throw and never claim echo', () => {
  assert.equal(isRemoteEchoTransaction(null), false);
  assert.equal(isRemoteEchoTransaction(undefined), false);
  assert.equal(isRemoteEchoTransaction({}), false); // no getMeta
  assert.equal(isRemoteEchoTransaction(tr().setMeta(ySyncPluginKey, { isChangeOrigin: false })), false);
});

console.log('collab-echo: ' + pass + '/4 passed');
