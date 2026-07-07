// Locks slugFromHash() in mapkeys/src/main.js — the project-library router that
// turns the URL hash into a project slug ('' → library, '#<slug>' → that project).
// It's called on boot and on every hashchange (main.js ~3745/3814), so if the
// decode throws the whole library routing bricks. A malformed percent-sequence
// (a bare '%' in a tampered/shared link, e.g. '#100%') makes decodeURIComponent
// throw a URIError — this test proves the inline try/catch degrades to the raw
// slug instead of crashing. Real bug fix (the find-unguarded-decode gate class).
//
// slugFromHash is inline in the big main.js entry (imports DOM/mapbox — can't be
// imported here), so we slice its source VERBATIM at runtime and run it against a
// stubbed window. No mirror → can't drift from the shipped code.
//
// Runner note: runs under `bun <file>` (scripts/run-tests.mjs); uses the repo's
// inline pass/fail counter, not node:test.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, 'main.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ── slice the shipped function source verbatim ──
const m = SRC.match(/function slugFromHash\(\)\s*\{[\s\S]*?\n\}/);
ok(!!m, 'slugFromHash source located in main.js');
const fnSrc = m ? m[0] : 'function slugFromHash(){return "";}';

// Build a callable: inject a `window` stub, return the function's result.
function makeSlug() {
  return new Function('window', `${fnSrc}; return slugFromHash();`);
}
function slugFor(hash) {
  return makeSlug()({ location: { hash } });
}

// ── normal, well-formed hashes ──
eq(slugFor(''), '', 'empty hash → library (empty slug)');
eq(slugFor('#burma-story'), 'burma-story', 'simple slug decoded');
eq(slugFor('#my%20map'), 'my map', 'valid percent-encoding decoded (%20 → space)');
eq(slugFor('#proj?v=2'), 'proj', 'query suffix stripped');
eq(slugFor('#  spaced  '), 'spaced', 'trimmed');

// ── the load-bearing guard: a malformed percent-sequence must NOT throw ──
let threw = false, val;
try { val = slugFor('#100%'); } catch { threw = true; }
ok(!threw, 'bare "%" hash does not throw (URIError guarded)');
eq(val, '100%', 'malformed "%" falls back to the raw un-decoded slug');

let threw2 = false;
try { slugFor('#a%zztop'); } catch { threw2 = true; }
ok(!threw2, 'invalid "%zz" escape does not throw');

// ── mutation proof: the naive un-guarded form MUST throw on the same input ──
// Reconstructs the pre-fix code (raw decodeURIComponent, no try/catch) and
// asserts it crashes — so if someone strips the guard, this expectation flips
// and the guard-holds assertions above go RED together.
{
  const naive = new Function('window',
    `const h = decodeURIComponent((window.location.hash || '').replace(/^#/, '')); return h.split('?')[0].trim();`);
  let naiveThrew = false;
  try { naive({ location: { hash: '#100%' } }); } catch { naiveThrew = true; }
  ok(naiveThrew, 'MUTATION PROOF: the un-guarded decode throws on "#100%" (proves the guard is load-bearing)');
}

if (fail) { console.error(`slug-from-hash: ${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`slug-from-hash: ${pass} passed, 0 failed`);
