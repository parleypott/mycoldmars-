import { parseScript } from "./parser";
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
