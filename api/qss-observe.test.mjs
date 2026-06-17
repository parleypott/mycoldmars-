// Test for deriveSignals — the server-side enrichment in api/qss-observe.js that
// tags every Henry observation with an `origin` (option | direction | kid) and the
// right signal shape before it's inserted. This is the PRODUCER half of the
// observe → qss-report dashboard pipeline (the consumer, summarize(), is locked in
// api/qss-report.test.mjs). It was ZERO-coverage.
//
// THE BUG THIS COVERS (fixed this iteration on the client side):
//   deriveSignals has always mapped block_added + payload.from==='direction' to
//   origin:'direction', and the parent dashboard has always had a 'direction'
//   bucket — but the QSS write client NEVER sent from:'direction'. Every committed
//   block went out as from:'option', so the dashboard's direction bucket was
//   permanently 0 even though Henry builds many blocks by first picking a creative
//   DIRECTION. The client now tags direction-steered options (fromDirection) and
//   sends from:'direction' at commit, finally feeding this already-correct branch.
//   This test locks the server contract the client now depends on.
//
// Run: node api/qss-observe.test.mjs   (or via `bun run test`)

import { deriveSignals } from './qss-observe.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const NO_CTX = {}; // handler always passes an object (body.context || {})

// ── origin mapping: the load-bearing contract ───────────────────────────────
// A block the kid wrote themselves.
eq(deriveSignals('own_block_added', { text: 'Scarlet flew.' }, NO_CTX).origin, 'kid',
   'own_block_added → origin kid');

// A block committed from an option that descended from a picked DIRECTION (the fix).
eq(deriveSignals('block_added', { text: 'Scarlet flew.', from: 'direction' }, NO_CTX).origin, 'direction',
   'block_added + from:direction → origin direction (the previously-dead branch)');

// A block committed from a plain option grab.
eq(deriveSignals('block_added', { text: 'Scarlet flew.', from: 'option' }, NO_CTX).origin, 'option',
   'block_added + from:option → origin option');

// A block_added with no provenance defaults to option (safe for legacy/old clients).
eq(deriveSignals('block_added', { text: 'Scarlet flew.' }, NO_CTX).origin, 'option',
   'block_added + no from → origin option (default)');

// option_added is enriched too; same origin rule applies.
eq(deriveSignals('option_added', { text: 'a tray option' }, NO_CTX).origin, 'option',
   'option_added + no from → origin option');
eq(deriveSignals('option_added', { text: 'a tray option', from: 'direction' }, NO_CTX).origin, 'direction',
   'option_added + from:direction → origin direction');

// own_block_added wins even if a stray from is present (checked first).
eq(deriveSignals('own_block_added', { text: 'x', from: 'direction' }, NO_CTX).origin, 'kid',
   'own_block_added precedence: kid wins over from:direction');

// ── direction_title passthrough ─────────────────────────────────────────────
const withDir = deriveSignals('block_added', { text: 'x', from: 'direction', direction: 'The dragon doubts herself' }, NO_CTX);
eq(withDir.direction_title, 'The dragon doubts herself', 'payload.direction → sig.direction_title');
ok(!('direction_title' in deriveSignals('block_added', { text: 'x', from: 'option' }, NO_CTX)),
   'no payload.direction → no direction_title key');

// ── blockSignals delegation: the text actually gets signal-extracted ─────────
const sig = deriveSignals('block_added', { text: 'Scarlet roared. The castle burned.' }, NO_CTX);
ok(typeof sig.words === 'number' && sig.words > 0, 'delegates word count to blockSignals');
ok(typeof sig.sentences === 'number' && sig.sentences >= 2, 'delegates sentence count (2 sentences)');
ok(Array.isArray(sig.characters), 'delegates characters array');
ok(Array.isArray(sig.settings) && sig.categories && typeof sig.categories === 'object', 'delegates settings (array) + categories (object)');

// extras (bible characters) are threaded into blockSignals so Henry's own names register.
const sigX = deriveSignals('block_added', { text: 'Then Zappy zoomed past.' }, { bibleCharacters: ['Zappy'] });
ok(sigX.characters.includes('Zappy'), 'context.bibleCharacters threaded into extraction');

// ── text source precedence: text || option_text || block_text ────────────────
eq(deriveSignals('option_added', { option_text: 'from option_text' }, NO_CTX).words, 2,
   'falls back to option_text when no text');
eq(deriveSignals('option_added', { block_text: 'one two three' }, NO_CTX).words, 3,
   'falls back to block_text when no text/option_text');
// empty text → blockSignals returns a zero-filled signal; origin still set.
const empty = deriveSignals('block_added', { from: 'option' }, NO_CTX);
eq(empty.words, 0, 'empty text → words 0');
eq(empty.origin, 'option', 'empty-text block still gets an origin');

// ── non-block events keep their own shapes ───────────────────────────────────
const dp = deriveSignals('direction_picked', { title: 'Doubt', vibe: 'tense', description: 'she hesitates' }, NO_CTX);
ok(dp.title === 'Doubt' && dp.vibe === 'tense' && dp.description === 'she hesitates' && !('origin' in dp),
   'direction_picked → {title,vibe,description}, no origin');
const dpEmpty = deriveSignals('direction_rejected', {}, NO_CTX);
ok(dpEmpty.title === '' && dpEmpty.vibe === '' && dpEmpty.description === '', 'direction_rejected defaults to empty strings');

const longPreview = 'z'.repeat(500);
const orj = deriveSignals('option_rejected', { kind: 'twist', text: longPreview }, NO_CTX);
eq(orj.kind, 'twist', 'option_rejected keeps kind');
eq(orj.preview.length, 200, 'option_rejected preview clamped to 200 chars');
ok(!('origin' in orj), 'option_rejected has no origin');
eq(deriveSignals('options_rejected_all', { kind: 'all', option_text: 'abc' }, NO_CTX).preview, 'abc',
   'options_rejected_all preview pulls from text source (option_text)');

// fallback: unrecognized event → shallow copy of payload.
const fb = deriveSignals('session_start', { device: 'ipad', n: 3 }, NO_CTX);
ok(fb.device === 'ipad' && fb.n === 3 && !('origin' in fb), 'unknown event → {...payload} passthrough');

// ── report ──────────────────────────────────────────────────────────────────
console.log(`\nqss-observe deriveSignals: ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
console.log('All deriveSignals tests passed.');
