// Lock the corrupt-localStorage guard on the QSS easter-egg state parse.
// The eggs() IIFE runs at the top of a large init scope in
// queen-scarlet-school/index.html; an unguarded JSON.parse there could throw
// synchronously and brick every handler defined after it (whole write app dead
// on load). This test proves (a) the BUG class is real and (b) the shipped
// guard neutralizes it, by extracting the exact guard form from the live HTML.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0; const fails = [];
const ok = (c, m) => c ? pass++ : (fail++, fails.push(m));

const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

// --- (a) the bug class: the OLD unguarded shape crashes on these values ---
// JSON.parse(getItem || '{}') then Object.values(state)/state[name].
const buggy = (raw) => {
  const state = JSON.parse(raw || '{}');          // raw is the stored string
  Object.values(state).filter(Boolean);           // bumpChip()
  return (state['lightning'] ? false : true);      // unlock()
};
let threwNull = false;
try { buggy('null'); } catch { threwNull = true; }
ok(threwNull, 'sanity: unguarded form throws on stored literal "null" (Object.values(null))');
let threwGarbage = false;
try { buggy('{not json'); } catch { threwGarbage = true; }
ok(threwGarbage, 'sanity: unguarded form throws on corrupt JSON');

// --- (b) the shipped guard: model it exactly as written, prove it never throws ---
const guarded = (raw) => {
  let state = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
  } catch {}
  // downstream uses must be safe:
  Object.values(state).filter(Boolean);
  const before = !state['x'];
  state['x'] = 1;
  return before && state['x'] === 1;
};
for (const bad of ['null', '{not json', '[]', '"str"', '42', 'true', null, '']) {
  let threw = false, res;
  try { res = guarded(bad); } catch { threw = true; }
  ok(!threw, `guarded form does not throw on ${JSON.stringify(bad)}`);
  ok(res === true, `guarded form yields a writable object on ${JSON.stringify(bad)}`);
}
// real saved object still works
ok(guarded('{"lightning":123}') === true, 'guarded form preserves a real saved object');

// --- (c) the guard is actually present in the shipped file (regression lock) ---
ok(/let state = \{\};\s*[\s\S]{0,200}typeof parsed === 'object' && !Array\.isArray\(parsed\)/.test(HTML),
   'live HTML carries the typeof-object && !isArray guard for qss-eggs-found state');
ok(!/const state = JSON\.parse\(localStorage\.getItem\(KEY\) \|\| '\{\}'\);/.test(HTML),
   'live HTML no longer has the unguarded const-parse form');

console.log(`${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  FAIL:', f); process.exit(1); }
