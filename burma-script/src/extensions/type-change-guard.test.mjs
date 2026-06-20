/**
 * RT-06 — 'Direction' (and any) type-change DATA-LOSS GUARD.
 *
 * THE BUG: the grip menu's 'Direction' maps a block to oncamBlock. changeBlockType copies only
 * attrs that exist on the TARGET node spec, so converting a sotBlock (timecode/speaker/done/…) to
 * oncamBlock (blockId only) DROPS all of them — the structured timecode + speaker vanish and, since
 * buildWorklists filters strictly on type==='sot', the quote disappears from the translation handoff
 * list. One misclick silently erases a SOT's producer data.
 *
 * THE FIX: attrsDroppedOnTypeChange() reports exactly which STRUCTURED data attrs would be lost so
 * changeBlockType can confirm before proceeding (a confirm dialog at runtime; this pure core is what
 * decides whether to even prompt). This proves the detection against the REAL node specs.
 *
 * Run: bun src/extensions/type-change-guard.test.mjs  (auto-discovered by run-tests.mjs)
 */
import { attrsDroppedOnTypeChange, BURMA_NODES } from './blocks.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const eq = (got, want, label) => ok(JSON.stringify([...got].sort()) === JSON.stringify([...want].sort()),
  `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);

// Resolve the real spec attrs for a node type by name from the live extension set.
function specAttrsFor(name) {
  const ext = BURMA_NODES.find((n) => n.name === name);
  // Tiptap Node.create stores addAttributes() output; call config.addAttributes if present.
  const fn = ext?.config?.addAttributes;
  if (typeof fn !== 'function') return {};
  try { return fn.call(ext) || {}; } catch { return {}; }
}

const sotSpec = specAttrsFor('sotBlock');
const oncamSpec = specAttrsFor('oncamBlock');
ok('timecode' in sotSpec, 'sotBlock spec carries timecode');
ok(!('timecode' in oncamSpec), 'oncamBlock spec does NOT carry timecode');

// A POPULATED SOT converted to Direction (oncam) drops its structured data → must be reported.
const populatedSot = { blockId: 'b1', timecode: '02:02:01:07', tcOut: '01:27:17:06', speaker: 'JH', done: true, rawTimecode: 'raw' };
eq(attrsDroppedOnTypeChange(populatedSot, oncamSpec),
   ['timecode', 'tcOut', 'speaker', 'done', 'rawTimecode'],
   'populated SOT -> Direction reports every structured attr as dropped');

// An EMPTY/default SOT (no real data) drops nothing → no prompt, silent conversion is fine.
const emptySot = { blockId: 'b2', timecode: '', tcOut: '', speaker: '', done: false, rawTimecode: '' };
eq(attrsDroppedOnTypeChange(emptySot, oncamSpec), [], 'empty SOT -> Direction drops nothing');

// SOT -> SOT (same spec) drops nothing.
eq(attrsDroppedOnTypeChange(populatedSot, sotSpec), [], 'SOT -> SOT drops nothing (target holds them)');

// done:false must NOT count as data (it's the default), but done:true must.
eq(attrsDroppedOnTypeChange({ done: false }, oncamSpec), [], 'done:false is not data');
eq(attrsDroppedOnTypeChange({ done: true }, oncamSpec), ['done'], 'done:true is data');

console.log(`type-change-guard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
