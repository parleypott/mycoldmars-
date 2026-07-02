// Burma Script importer — TIMECODE-ROUTING STATEFULNESS regression lock.
//
// parser.ts keeps TWO instances of the same timecode pattern ON PURPOSE:
//   • TC      (/g)  — for matchAll / extraction  (findTimecodes)
//   • TC_HAS  (no g) — for the .test() routing check at parser.ts:154
// The header comment there (parser.ts:27-33, 152-153) documents the exact bug this file
// locks: RegExp.prototype.test() on a /g regex ADVANCES .lastIndex, so consecutive .test()
// calls on the SAME global instance resume mid-string and alternate true/false — silently
// dropping every OTHER timecode-bearing paragraph into the holding bin. In Johnny's real
// multi-SOT scripts that means real soundbites vanish from the producer's SOT list.
//
// routing-test.ts already locks the block CLASSIFIER, but every one of its fixtures is a
// SINGLE paragraph per parseScript() call — so the statefulness failure mode (which only
// manifests across MULTIPLE consecutive timecode paragraphs in ONE call) had no designed
// assertion at all. This file supplies it: one parseScript() call, five back-to-back timecode
// SOTs, assert ALL FIVE route to `sot` (none fall through to the bin).
//
// WHAT THIS LOCKS — the END-TO-END guarantee, not one line. The parser defends this bug with
// TWO independent guards: (1) line 154 uses the NON-global TC_HAS for the routing .test(), and
// (2) timecodeFrom() resets `TC.lastIndex = 0` ("defensively anyway") before its matchAll, and
// a failed /g .test() auto-resets lastIndex to 0. So NO single edit reintroduces the drop —
// which is exactly why a one-line mutation of :154 alone still passes. The risk this test
// guards is the plausible future refactor that erodes BOTH: someone deletes the "defensive
// anyway" reset (its own comment invites it) AND the routing ever shares the global TC.
//
// MUTATION PROOF (verified by hand): make :154 `TC.test(p)` AND remove :90's `TC.lastIndex=0`
// → paragraphs #2 and #4 drop out of `sot` (they become `vo`), count 3/5, this test goes RED.
// Restore either guard → GREEN. So the test is non-vacuous: it fires the moment the doubly-
// guarded end-to-end invariant is actually broken.
//   Run: bun tc-routing-statefulness-test.ts
import { parseScript } from "./parser";

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (got === want) { pass++; }
  else { fail++; console.error(`  FAIL ${label}\n       got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`); }
}

// Five consecutive, unambiguous SOT paragraphs (speaker-attributed, plain prose — no b-roll
// words like roll/establish/montage — so the ONLY thing that can knock one off `sot` is the
// timecode-detection check failing). \n-joined → parseScript splits them into 5 paragraphs.
const doc5 = [
  "[01:00:00:00] Jack: the border was quiet before the coup",
  "[02:00:00:00] Drew: families crossed the river after dark",
  "[03:00:00:00] JH: the checkpoints appeared almost overnight",
  "[04:00:00:00] Jack: the soldiers checked every travel paper",
  "[05:00:00:00] Drew: the schools kept teaching in secret",
].join("\n");

const { doc } = parseScript(doc5);
const tcBlocks = doc.blocks.filter((b: any) => b.type === "sot" || b.type === "broll");

// The load-bearing assertion: every one of the five timecode paragraphs routed to a
// timecode-bearing block. A stateful-/g regression drops the even-indexed ones → count < 5.
eq("all five consecutive timecode SOTs route to sot/broll (none dropped to bin)", tcBlocks.length, 5);
// And specifically all five are `sot` (speaker-attributed, no footage cues).
eq("all five are typed sot", doc.blocks.filter((b: any) => b.type === "sot").length, 5);
// Belt-and-suspenders: none leaked into the holding bin.
eq("no timecode paragraph fell into the bin", doc.blocks.filter((b: any) => b.type === "bin").length, 0);

// Also assert identity is intact — the 2nd and 4th paragraphs (the ones a /g regression
// drops) are present as timecode blocks, so a partial regression can't hide behind a count.
eq("2nd paragraph is a timecode block", doc.blocks[1]?.type, "sot");
eq("4th paragraph is a timecode block", doc.blocks[3]?.type, "sot");

console.log(`=== TC ROUTING STATEFULNESS: ${pass}/${pass + fail} cases pass ===`);
if (fail) process.exit(1);
