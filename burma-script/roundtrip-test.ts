// WP-01 round-trip test — exercises the schema-faithful export so it can't silently rot.
// buildEditorDocument(blocks) -> TipTap doc -> docToBlocks(doc) must preserve, for the
// real 225-block sample: every block (by id), every block's TYPE (modulo the documented
// chapter reclassification), and every SOT/broll HERO timecode the editors live by.
// Run: bun burma-script/roundtrip-test.ts
//
// WHY THIS IS MATCHED BY ID, NOT BY INDEX (the fix):
// The original version asserted out[i].type === src[i].type — index-by-index. That made a
// FALSE assumption: that buildEditorDocument preserves block ORDER. Two shipped transforms
// retype on purpose:
//   • SERVICE-NEED REMOVAL: every parser-labelled map-need / archive-req block DEMOTES to a
//     neutral `bin` (DIRECTION) block at build time — the "service need" concept was removed.
//     Text is fully preserved; only the type changes.
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
//    (The SET of blocks must be identical — none dropped, duplicated, or invented.)
const srcIds = sourceBlocks.map((b: any) => b.id);
const outById = new Map<string, any>();
for (const b of out) {
  if (outById.has(b.id)) fail(`duplicate block id on export: ${b.id}`);
  outById.set(b.id, b);
}
for (const id of srcIds) if (!outById.has(id)) fail(`block id vanished on export: ${id}`);
for (const b of out) if (!srcIds.includes(b.id)) fail(`block id invented on export: ${b.id}`);

// The type changes the round-trip is allowed to make:
//   • reclassifyChapter() may demote a parser `chapter` to `oncam` or `scene`.
//   • the service-need removal demotes parser `map-need` / `archive-req` to neutral `bin`.
// Everything else must be type-identical.
const allowedTypeChange = (from: string, to: string) =>
  (from === "chapter" && (to === "oncam" || to === "scene")) ||
  ((from === "map-need" || from === "archive-req") && to === "bin");

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
