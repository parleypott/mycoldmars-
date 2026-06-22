// Lock parseSessionList — the research-hub session-list parser that guarantees
// loadSessions() always returns an array, so a corrupt/legacy non-array stored
// value can't hard-crash newSession (spread), updateSession (.findIndex),
// openSession (.find), or renderHistory (iterate/slice).
//
// Run: bun research/sessions-store.test.mjs   (auto-discovered by `bun run test`)
import { parseSessionList } from "./sessions-store.js";

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  expected ${B}\n  got      ${A}`); };
};
const ok = (c, msg) => { if (c) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

// ── inline RED proof: reconstruct the OLD loadSessions body and show it
//    returns a non-array that crashes the real consumers ──────────────────
function oldParse(raw) { return JSON.parse(raw) ?? []; }
{
  // newSession does `[s, ...loadSessions()]`; updateSession does `.findIndex`.
  for (const raw of ["{}", "5"]) {
    const oldVal = oldParse(raw);
    ok(!Array.isArray(oldVal), `RED: old parse(${raw}) returns a non-array`);
    let spreadThrew = false;
    try { [...oldVal]; } catch { spreadThrew = true; }
    ok(spreadThrew, `RED: old parse(${raw}) crashes the [s, ...sessions] spread`);
    let findThrew = false;
    try { oldVal.findIndex(() => false); } catch { findThrew = true; }
    ok(findThrew, `RED: old parse(${raw}) crashes .findIndex`);
    // the fixed parser defuses both
    const v = parseSessionList(raw);
    ok(Array.isArray(v), `fixed parse(${raw}) returns an array`);
    let crash = false;
    try { [...v]; v.findIndex(() => false); v.find(() => false); v.slice(0, 24); } catch { crash = true; }
    ok(!crash, `fixed parse(${raw}) survives spread/findIndex/find/slice`);
  }
}

// ── the fix: every non-array stored value degrades to [] ──────────────────
eq(parseSessionList("{}"), [], "object value -> []");
eq(parseSessionList('{"a":1}'), [], "populated object -> []");
eq(parseSessionList("5"), [], "number -> []");
eq(parseSessionList("0"), [], "zero -> []");
eq(parseSessionList("true"), [], "boolean -> []");
eq(parseSessionList('"x"'), [], "string value -> []");
eq(parseSessionList("null"), [], "JSON null -> []");

// ── absent / malformed -> [] (matches the old `?? []` + try/catch) ────────
eq(parseSessionList(null), [], "absent key (getItem null) -> []");
eq(parseSessionList(undefined), [], "undefined -> []");
eq(parseSessionList(""), [], "empty string -> []");
eq(parseSessionList("not json {"), [], "malformed JSON -> []");
eq(parseSessionList("[1,2,"), [], "truncated array -> []");

// ── no-regression: a real array passes through verbatim, order + contents ─
eq(parseSessionList("[]"), [], "empty array preserved");
const real = [
  { id: "a", prompt: "x", createdAt: "2026-06-22T00:00:00Z" },
  { id: "b", prompt: "y", createdAt: "2026-06-22T01:00:00Z" },
];
eq(parseSessionList(JSON.stringify(real)), real, "session array preserved verbatim (order + fields)");
eq(parseSessionList('[1,2,3]'), [1, 2, 3], "primitive array preserved");

// ── invariant: result is ALWAYS a .map/.find/.findIndex/spread-safe array ─
for (const raw of ["{}", "5", '"x"', "null", "[1]", null, undefined, "", "bad{", "true", '{"sessions":[]}']) {
  const v = parseSessionList(raw);
  ok(Array.isArray(v), `invariant: parseSessionList(${JSON.stringify(raw)}) is an array`);
  let crashed = false;
  try { [...v]; v.findIndex(() => false); v.find(() => false); v.slice(0, 24).map((s) => s); } catch { crashed = true; }
  ok(!crashed, `invariant: consumers never throw for ${JSON.stringify(raw)}`);
}

console.log(`\nsessions-store.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
