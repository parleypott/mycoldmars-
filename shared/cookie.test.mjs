// Locks parseCookieValue (shared/cookie.js) — the regex-free cookie reader that
// replaced the unescaped `new RegExp("(?:^|; )" + name + "=([^;]*)")` parse in
// research/app.js + translation/src/gate.js (the dynamic-RegExp-injection class).
//
// Proves: (1) the OLD regex parse mis-parses/injects on a metacharacter cookie
// name while parseCookieValue does not; (2) parseCookieValue === the old regex
// for the real call sites (constant `np_access` + encoded values) — zero
// regression; (3) the standard not-found / edge behavior.
//
// Run: bun shared/cookie.test.mjs   (auto-discovered by scripts/run-tests.mjs)

import { parseCookieValue } from "./cookie.js";

let pass = 0,
  fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a),
    B = JSON.stringify(b);
  if (A === B) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${msg}\n  expected ${B}\n  got      ${A}`);
  }
};

// Faithful reconstruction of the OLD shipped getCookie regex parse (the bug).
function oldRegexParse(cookieString, name) {
  const m = String(cookieString).match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

// ── RED proof: the old regex injects on a metacharacter cookie name ──
// A cookie name with a `.` is compiled as "any char". On a cookie string where a
// DIFFERENT cookie matches the loosened pattern, the old parse returns the WRONG
// value; the literal cookie it was asked for is shadowed.
{
  const jar = "npXaccess=INJECTED; np.access=REAL";
  eq(oldRegexParse(jar, "np.access"), "INJECTED", "RED: old regex matches npXaccess via the unescaped dot");
  eq(parseCookieValue(jar, "np.access"), "REAL", "FIX: parseCookieValue returns the literal np.access cookie");
}
{
  // A `*` name with no literal match would, under the old regex, match a zero-or-more
  // expansion of the preceding char and capture an unrelated value; parseCookieValue
  // finds no exact "ab*" cookie and returns null.
  // `ab*` = "a" then zero+ "b": the old regex matches the FIRST cookie `a=1`
  // (a, zero b's, =) and returns "1" — a wrong, non-null value for a cookie name
  // that has no literal match. parseCookieValue finds no exact "ab*" -> null.
  const jar = "a=1; abbb=GREEDY; b=2";
  eq(oldRegexParse(jar, "ab*"), "1", "RED: old regex `ab*` wrongly matches a=1");
  eq(parseCookieValue(jar, "ab*"), null, "FIX: no literal `ab*` cookie -> null");
}

// ── no-regression sweep: parseCookieValue === old regex for SAFE names ──
// (the real call sites only ever pass the metachar-free constant `np_access`)
const safeJars = [
  "np_access=abc123",
  "a=1; np_access=abc123; b=2",
  "np_access=", // present but empty
  "np_access=a%20b%3Dc", // encoded value (space + '=')
  "session=x; theme=dark; np_access=tok_456", // last
  "np_access=first; other=second", // first
  "", // empty jar
  "unrelated=1; other=2", // absent
];
for (const jar of safeJars) {
  eq(
    parseCookieValue(jar, "np_access"),
    oldRegexParse(jar, "np_access"),
    `no-regression: np_access in ${JSON.stringify(jar)}`,
  );
}
// also for a couple other metachar-free names
for (const jar of ["mcm_access_code=zzz; np_access=q", "x=1"]) {
  eq(
    parseCookieValue(jar, "mcm_access_code"),
    oldRegexParse(jar, "mcm_access_code"),
    `no-regression: mcm_access_code in ${JSON.stringify(jar)}`,
  );
}

// ── direct behavior locks ──
eq(parseCookieValue("np_access=hello", "np_access"), "hello", "basic value");
eq(parseCookieValue("a=1; np_access=hi; b=2", "np_access"), "hi", "value among many");
eq(parseCookieValue("np_access=", "np_access"), "", "present-but-empty -> empty string");
eq(parseCookieValue("a=1; b=2", "np_access"), null, "absent -> null");
eq(parseCookieValue("np_access=a%20b", "np_access"), "a b", "decodes %20");
eq(parseCookieValue("np_access=k%3Dv", "np_access"), "k=v", "decodes %3D (=) in value");
eq(parseCookieValue("np_access=plain=eq", "np_access"), "plain=eq", "value containing a literal = kept whole");
eq(parseCookieValue("np_access=first", "np_access"), "first", "first cookie (no leading separator)");
eq(parseCookieValue("a=1; npaccessx=2", "np_access"), null, "no partial/substring match");
// prefix-superset cookie must NOT shadow an exact lookup (exact match, not startsWith)
eq(parseCookieValue("np_access_token=SUPERSET; np_access=REAL", "np_access"), "REAL", "exact key, not prefix");
eq(parseCookieValue("np_access_token=ONLY", "np_access"), null, "prefix-superset alone -> null (exact match)");
eq(parseCookieValue("np_access=%E0%A4", "np_access"), "%E0%A4", "malformed encoding -> raw, no throw");

// ── degenerate inputs: never throw, always string-or-null ──
eq(parseCookieValue(null, "np_access"), null, "null jar -> null");
eq(parseCookieValue(undefined, "np_access"), null, "undefined jar -> null");
eq(parseCookieValue(42, "np_access"), null, "non-string jar -> null");
eq(parseCookieValue("np_access=x", ""), null, "empty name -> null");
eq(parseCookieValue("np_access=x", null), null, "null name -> null");

console.log(`\nshared/cookie.test.mjs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
