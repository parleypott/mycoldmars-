// WP-01 round-trip test — exercises the schema-faithful export so it can't silently rot.
// buildEditorDocument(blocks) -> TipTap doc -> docToBlocks(doc) must preserve each
// block's TYPE and (for SOT/broll) the HERO timecode datum the editors live by.
// Run: bun burma-script/roundtrip-test.ts
//
// This is the runtime proof the critic asked for: docToBlocks() is otherwise only an
// exported derived view; this keeps the round-trip honest against the real 225 blocks.

import { buildEditorDocument, docToBlocks } from "./src/document-builder.js";
import sample from "./sample-blocks.json";

const sourceBlocks = (sample as any).blocks || [];
const doc = buildEditorDocument(sourceBlocks);
const out = docToBlocks(doc);

let failures = 0;
const fail = (msg: string) => { failures++; console.error("  ✗ " + msg); };

// 1) count preserved
if (out.length !== sourceBlocks.length)
  fail(`block count drifted: ${sourceBlocks.length} in, ${out.length} out`);

// 2) type fidelity per block
sourceBlocks.forEach((src: any, i: number) => {
  const got = out[i];
  if (!got) { fail(`block ${i} (${src.type}) vanished`); return; }
  if (got.type !== src.type)
    fail(`block ${i} type drift: ${src.type} -> ${got.type}`);
});

// 3) timecode HERO fidelity on every SOT/broll
const tcBlocks = sourceBlocks
  .map((b: any, i: number) => ({ b, i }))
  .filter(({ b }: any) => b.type === "sot" || b.type === "broll");

let tcChecked = 0;
for (const { b, i } of tcBlocks) {
  const got = out[i];
  const srcTc = (b.timecode?.tc || "").trim();
  const gotTc = (got?.timecode?.tc || "").trim();
  // formatTimecode normalises to HH:MM:SS:FF; assert the normalised value survives.
  const norm = srcTc.match(/(\d{1,2}:\d{2}:\d{2}:\d{2})/)?.[1] || srcTc;
  if (norm && gotTc !== norm)
    fail(`block ${i} (${b.type}) timecode drift: "${norm}" -> "${gotTc}"`);
  if (got && !!got.done !== !!b.done)
    fail(`block ${i} (${b.type}) done flag drift`);
  tcChecked++;
}

console.log(`round-trip: ${sourceBlocks.length} blocks, ${tcChecked} timecode blocks checked`);
if (failures) { console.error(`FAILED — ${failures} assertion(s) broke`); process.exit(1); }
console.log("OK — type + timecode fidelity preserved through buildEditorDocument -> docToBlocks");
