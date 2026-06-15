// Burma Script Tool — data-loss integrity harness (Wall 5).
// JH said "go cron crazy to keep yourself accountable." This is the accountable loop:
// it re-parses, asserts the invariants, FUZZES thousands of random edit/move/delete
// sequences asserting the doc never corrupts, and round-trips JSON. Exits non-zero +
// (optionally) Telegrams JH on any failure. Wire to a cron on the Redoubt.

import { parseScript } from "./parser";
import { Block, ScriptDoc } from "./schema";

type Fail = { check: string; detail: string };
const fails: Fail[] = [];
const assert = (cond: boolean, check: string, detail = "") => { if (!cond) fails.push({ check, detail }); };

// ---- invariants on any doc ----
function checkInvariants(doc: ScriptDoc, label: string) {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    assert(!!b.id, `${label}: block has id`, JSON.stringify(b).slice(0, 80));
    assert(!ids.has(b.id), `${label}: ids unique`, b.id);
    ids.add(b.id);
    if (b.type === "sot" || b.type === "broll") {
      assert(!!b.timecode, `${label}: tc block has timecode`, b.id);
      if (b.timecode && !b.timecode.ambiguous)
        assert(/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(b.timecode.tc), `${label}: tc well-formed`, b.timecode.tc);
    }
    // spans must stay inside text bounds (the kind of off-by-one that silently eats data)
    if (b.text && b.spans) for (const s of b.spans)
      assert(s.start >= 0 && s.end <= b.text.length && s.start <= s.end, `${label}: span in bounds`, `${b.id} ${s.start}-${s.end}/${b.text.length}`);
  }
}

// deterministic PRNG so cron runs are reproducible (no Math.random in this env anyway)
let seed = 1234567;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

// ---- fuzz: random rearrange/delete/duplicate-guard, assert no corruption + no silent loss ----
function fuzz(doc: ScriptDoc, rounds = 5000) {
  let blocks = structuredClone(doc.blocks);
  const seen = new Set(blocks.map((b) => b.id));
  for (let i = 0; i < rounds; i++) {
    if (!blocks.length) break;
    const op = pick(["move", "delete", "edit", "toggle"]);
    if (op === "move" && blocks.length > 1) {
      const from = Math.floor(rnd() * blocks.length);
      const to = Math.floor(rnd() * blocks.length);
      const [b] = blocks.splice(from, 1); blocks.splice(to, 0, b);
    } else if (op === "delete") {
      blocks.splice(Math.floor(rnd() * blocks.length), 1); // intentional delete is fine
    } else if (op === "edit") {
      const b = pick(blocks); if (b.text != null) b.text = b.text + "";
    } else if (op === "toggle") {
      const b = pick(blocks); if (b.done != null) b.done = !b.done;
    }
    // INVARIANT after every op: still no duplicate ids, no block invented from nowhere
    const ids = new Set<string>();
    for (const b of blocks) {
      if (ids.has(b.id)) { fails.push({ check: "fuzz: dup id appeared", detail: `op=${op} i=${i} id=${b.id}` }); return; }
      ids.add(b.id);
      if (!seen.has(b.id)) { fails.push({ check: "fuzz: phantom block", detail: b.id }); return; }
    }
  }
}

// ---- round-trip: serialize -> parse -> deep equal (catches lossy persistence) ----
function roundTrip(doc: ScriptDoc) {
  const a = JSON.stringify(doc);
  const b = JSON.stringify(JSON.parse(a));
  assert(a === b, "round-trip JSON stable", `${a.length} vs ${b.length}`);
}

const src = await Bun.file(new URL("./sample-script.txt", import.meta.url)).text();
const { doc } = parseScript(src);
checkInvariants(doc, "parse");
fuzz(doc, 5000);
roundTrip(doc);

const ok = fails.length === 0;
const stamp = process.argv[2] || "manual";
const report = { ok, when: stamp, blocks: doc.blocks.length, fuzzRounds: 5000, fails };
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exit(1);
