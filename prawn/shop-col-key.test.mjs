// Verifier-layer LOCK for prawn's shopping-list checkbox-persistence key.
//
// The shopping list (BOSS MODE, prawn/index.html renderPrep) persists which
// items are checked off in localStorage under a key `${colItem}::${text}`.
// `colItem` USED to be the raw <h4> textContent — "🍔 food (3)" — which carries
// a LIVE count. So the moment a new RSVP changed the number of food/drink items,
// the count flipped ("(3)"→"(4)"), every persisted key changed, and all the
// checkmarks silently reset — defeating the whole "checking off items survives
// reloads" purpose on exactly the event (a new RSVP mid-planning) when Johnny +
// Marisa are shopping the list.
//
// FIX: derive the column key through shopColKey(), which strips the trailing
// " (N)" so the persistence key is COUNT-INDEPENDENT. This test extracts the
// real shipped shopColKey from index.html at runtime (brace-matched), so it
// can't drift from a hand-copied mirror. Mutation-proof: revert shopColKey to
// the raw textContent (drop the .replace) and the count-independence assertion
// below goes RED.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'index.html'), 'utf8');

function braceMatch(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces from ' + openIdx);
}
function extractFn(src, name) {
  const sig = src.indexOf('function ' + name + '(');
  assert.ok(sig !== -1, 'missing function ' + name);
  const open = src.indexOf('{', sig);
  return src.slice(sig, braceMatch(src, open));
}

const shopColKey = new Function('return (' + extractFn(SRC, 'shopColKey') + ')')();

let pass = 0;
const eq = (got, want, msg) => { assert.strictEqual(got, want, `${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); pass++; };

// --- the count is stripped ---------------------------------------------------
eq(shopColKey('🍔 food (3)'), '🍔 food', 'strips food count');
eq(shopColKey('🍺 drink (12)'), '🍺 drink', 'strips drink count');
eq(shopColKey('🍔 food (0)'), '🍔 food', 'strips a zero count');

// --- LOAD-BEARING: the key is COUNT-INDEPENDENT (this is the whole bug) -------
// A persisted checkmark keyed at count (3) must still resolve after a new RSVP
// bumps the list to (4). If shopColKey stops stripping the count, these diverge
// and the checkmark is lost — exactly the regression this locks.
eq(shopColKey('🍔 food (3)'), shopColKey('🍔 food (4)'),
   'food key is identical across a count change (3 -> 4)');
eq(shopColKey('🍺 drink (2)'), shopColKey('🍺 drink (9)'),
   'drink key is identical across a count change (2 -> 9)');

// --- degradation / edge cases ------------------------------------------------
eq(shopColKey(null), '', 'null -> empty (no throw)');
eq(shopColKey(undefined), '', 'undefined -> empty (no throw)');
eq(shopColKey(''), '', 'empty -> empty');
eq(shopColKey('🍔 food'), '🍔 food', 'no count present -> unchanged');
// A parenthetical that is NOT a trailing count is preserved (only the trailing
// (N) is volatile). Guards against over-stripping real item labels.
eq(shopColKey('food (spicy) (3)'), 'food (spicy)', 'only the TRAILING numeric count is stripped');

console.log(`shop-col-key: ${pass} passed, 0 failed`);
