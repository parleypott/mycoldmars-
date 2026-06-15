import { parseScript, findTimecodes } from "./parser";

// --- TIMECODE DETECTOR regression suite (punch-list #8) ----------------------------------
// Every HH:MM:SS:FF must be found even glued to a bracket, backslash-escape, paren, quote,
// em-dash, or a LABEL colon — while genuine longer numeric runs are rejected. Locks the fix.
const tcCases: [string, string[]][] = [
  ["\\[02:02:01:07\\]", ["02:02:01:07"]],                 // backslash-escaped bracket
  ["TC]02:02:01:07", ["02:02:01:07"]],                     // close-bracket glued
  ["[02:02:01:07 stopping for gas", ["02:02:01:07"]],      // open-bracket glued
  ["(03:08:33:13)", ["03:08:33:13"]],                      // parens
  ["ALT:03:19:40:07 here", ["03:19:40:07"]],               // label-colon prefix
  ["DAY 2 SOT:01:08:54:15 nice", ["01:08:54:15"]],         // label-colon prefix 2
  ["04:36:46:01: long shot", ["04:36:46:01"]],             // trailing "tc: description"
  ["03:15:11:03- 03:15:38:05 range", ["03:15:11:03", "03:15:38:05"]], // a range, both
  ["“05:17:12:11” this is nuts", ["05:17:12:11"]],         // smart-quote wrapped
  ["12:34:56:78:90", []],                                  // 5-field run rejected
  ["102:02:01:070", []],                                   // embedded in longer run rejected
  ["1:02:02:01:07", []],                                   // digit-colon prefix (sub-field) rejected
];
let tcPass = 0;
for (const [input, want] of tcCases) {
  const got = findTimecodes(input);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) tcPass++;
  else console.error(`  TC FAIL ${JSON.stringify(input)} -> got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
console.log(`=== TIMECODE DETECTOR: ${tcPass}/${tcCases.length} adversarial cases pass ===`);
if (tcPass !== tcCases.length) process.exit(1);

const src = await Bun.file("./sample-script.txt").text();
const { doc, stats, ambiguous } = parseScript(src);
console.log("=== PARSE STATS (your real script) ===");
console.log(JSON.stringify(stats, null, 2));
console.log("\n=== CHAPTERS DETECTED (the spine + genre) ===");
for (const b of doc.blocks.filter(b => b.type === "chapter"))
  console.log(`  [${(b.genre||"").toUpperCase().padEnd(8)}] ${b.title}`);
console.log("\n=== first 6 ambiguous-DAY timecodes flagged for JH ===");
ambiguous.slice(0,6).forEach(a => console.log(`  TC ${a.tc} — "${a.raw.slice(0,60)}..."`));
await Bun.write("./sample-blocks.json", JSON.stringify(doc, null, 2));
console.log("\nwrote sample-blocks.json (" + doc.blocks.length + " blocks)");
