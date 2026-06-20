/*
 * is-renderable-local-doc.test.mjs — CH-06 guard.
 *
 * Startup had three drifting definitions of "usable local doc" (hasUsableLocalDoc in main.jsx,
 * seedDoc in Editor.jsx, the migrate base-gate in migrateStoredDoc). They now all call ONE shared
 * predicate, isRenderableLocalDoc(raw|parsed), so "usable" means exactly one thing. This locks its
 * contract: parses to an object with a non-empty content array; flat (non-table) docs still count
 * (ensureTableDoc wraps them at seed time); table-shape is NOT required here.
 */
import { isRenderableLocalDoc } from './migrate-doc.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗', name); } }

// Accepts a parsed object.
ok('non-empty content (parsed)', isRenderableLocalDoc({ type: 'doc', content: [{ type: 'paragraph' }] }) === true);
// Accepts a raw JSON string.
ok('non-empty content (raw string)', isRenderableLocalDoc(JSON.stringify({ type: 'doc', content: [{ type: 'x' }] })) === true);
// FLAT (pre-table) doc is still renderable — ensureTableDoc wraps it at seed time.
ok('flat doc renderable', isRenderableLocalDoc({ type: 'doc', content: [{ type: 'voBlock' }, { type: 'sotBlock' }] }) === true);
// table-shaped doc renderable.
ok('table doc renderable', isRenderableLocalDoc({ type: 'doc', content: [{ type: 'tableRow', content: [] }] }) === true);

// Rejections — every "not usable" shape the three call sites must agree on.
ok('empty content rejected', isRenderableLocalDoc({ type: 'doc', content: [] }) === false);
ok('missing content rejected', isRenderableLocalDoc({ type: 'doc' }) === false);
ok('content not array rejected', isRenderableLocalDoc({ type: 'doc', content: 'nope' }) === false);
ok('null rejected', isRenderableLocalDoc(null) === false);
ok('undefined rejected', isRenderableLocalDoc(undefined) === false);
ok('unparseable string rejected', isRenderableLocalDoc('{not json') === false);
ok('non-doc-object string rejected', isRenderableLocalDoc('42') === false);
ok('empty string rejected', isRenderableLocalDoc('') === false);

console.log(`is-renderable-local-doc: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
