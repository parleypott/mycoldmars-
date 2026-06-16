// WP-01 round-trip test — exercises the schema-faithful export so it can't silently rot.
// buildEditorDocument(blocks) -> TipTap doc -> docToBlocks(doc) must preserve, for the
// real 225-block sample: every block (by id), every block's TYPE (modulo the documented
// chapter reclassification), and every SOT/broll HERO timecode the editors live by.
// Run: bun burma-script/roundtrip-test.ts
//
// WHY THIS IS MATCHED BY ID, NOT BY INDEX (the fix):
// The original version asserted out[i].type === src[i].type — index-by-index. That made a
// FALSE assumption: that buildEditorDocument preserves block ORDER. It deliberately does
// not. Two shipped transforms reshuffle/retype on purpose:
//   • FEATURE D (service consolidation): every map-need / archive-req block is gathered into
//     ONE serviceGroup emitted at the FIRST service block's slot; docToBlocks unwraps them
//     back in document order. So service blocks RELOCATE — every index after the first
//     service block shifts. Index-by-index then reads misaligned pairs as "type drift" and
//     "timecode drift" (the old "block 214 sot 02:28:42:08 -> 02:26:45:07" was a MISALIGNED
//     comparison, not a corrupted timecode — proven: the timecode multiset is byte-identical).
//   • CHAPTER RECLASSIFICATION (the cadence fix): reclassifyChapter() demotes an over-eager
//     `chapter` to `oncam` or `scene`. That is a real, intended type change on export.
// Matching by id makes the test order-independent, so it asserts the contract the round-trip
// ACTUALLY guarantees while still catching genuine corruption: a dropped/duplicated block, a
// mutated or vanished timecode, or an UNdocumented type change.

import { buildEditorDocument, docToBlocks } from "./src/document-builder.js";
import sample from "./sample-blocks.json";

const sourceBlocks = (sample as any).blocks || [];
const doc = buildEditorDocument(sourceBlocks);
const out = docToBlocks(doc);

let failures = 0;
const fail = (msg: string) => { failures++; console.error("  ✗ " + msg); };

// 1) count preserved — no block invented or dropped on the round-trip.
if (out.length !== sourceBlocks.length)
  fail(`block count drifted: ${sourceBlocks.length} in, ${out.length} out`);

// 2) id fidelity — every source block id comes back exactly once, none invented.
//    (Order may change — service blocks relocate — but the SET of blocks must be identical.)
const srcIds = sourceBlocks.map((b: any) => b.id);
const outById = new Map<string, any>();
for (const b of out) {
  if (outById.has(b.id)) fail(`duplicate block id on export: ${b.id}`);
  outById.set(b.id, b);
}
for (const id of srcIds) if (!outById.has(id)) fail(`block id vanished on export: ${id}`);
for (const b of out) if (!srcIds.includes(b.id)) fail(`block id invented on export: ${b.id}`);

// The ONLY type changes the round-trip is allowed to make: reclassifyChapter() may demote a
// parser-labelled `chapter` to `oncam` or `scene`. Everything else must be type-identical.
const allowedTypeChange = (from: string, to: string) =>
  from === "chapter" && (to === "oncam" || to === "scene");

// 3) type fidelity per block, MATCHED BY ID (order-independent).
sourceBlocks.forEach((src: any) => {
  const got = outById.get(src.id);
  if (!got) return; // already reported as vanished above
  if (got.type !== src.type && !allowedTypeChange(src.type, got.type))
    fail(`block ${src.id} type drift: ${src.type} -> ${got.type}`);
});

// 4) timecode HERO fidelity on every SOT/broll, MATCHED BY ID.
const tcBlocks = sourceBlocks.filter((b: any) => b.type === "sot" || b.type === "broll");
let tcChecked = 0;
for (const b of tcBlocks) {
  const got = outById.get(b.id);
  if (!got) continue; // vanished — already reported
  const srcTc = (b.timecode?.tc || "").trim();
  const gotTc = (got.timecode?.tc || "").trim();
  // formatTimecode normalises to HH:MM:SS:FF; assert the normalised value survives byte-identical.
  const norm = srcTc.match(/(\d{1,2}:\d{2}:\d{2}:\d{2})/)?.[1] || srcTc;
  if (norm && gotTc !== norm)
    fail(`block ${b.id} (${b.type}) timecode drift: "${norm}" -> "${gotTc}"`);
  if (!!got.done !== !!b.done)
    fail(`block ${b.id} (${b.type}) done flag drift`);
  tcChecked++;
}

console.log(`round-trip: ${sourceBlocks.length} blocks, ${tcChecked} timecode blocks checked (matched by id)`);
if (failures) { console.error(`FAILED — ${failures} assertion(s) broke`); process.exit(1); }
console.log("OK — id + type + timecode fidelity preserved through buildEditorDocument -> docToBlocks");
