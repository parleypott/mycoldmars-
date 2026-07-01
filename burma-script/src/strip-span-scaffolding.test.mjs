/**
 * strip-span-scaffolding.test.mjs — locks stripSpanScaffolding, the PRODUCER-FACING
 * handoff cleaner in Johnny's Burma/Palau Script tool. It is the documented INVERSE of
 * wrapToken/inlineContent: worklists.js builds every translator/producer checklist row as
 * `stripSpanScaffolding(cleanQuote(b.text))`, so this function decides what a producer
 * actually reads. Its whole job is to peel the inline span markup ({tk …}/{fc …}/{fact …}
 * brace tokens, [visual …] brackets, and any stray/unterminated scaffolding) back to clean
 * prose so NO raw markup leaks into the read-only handoff view.
 *
 * Why a DIRECT lock: wrapToken (its inverse) is mutation-locked in wrap-token.test.mjs, but
 * stripSpanScaffolding had ZERO coverage — worklists.test.mjs never feeds it a span token.
 * The two must stay in sync (the source comment says so, guarded by nothing until now): if a
 * refactor breaks the unwrap, Johnny's exported worklists silently show "{tk one fifth}" /
 * "[wide drone shot]" raw markup instead of clean prose.
 *
 * Mutation honesty: the four regex stages are the brace-token unwrap (keyword+braces → inner),
 * the [visual] bracket unwrap, the unterminated-'{tk' peel, and the stray lone-glyph strip.
 * Stages 1, 3, and 4 are each UNIQUELY mutation-proven — neutering any one turns a specific
 * assertion RED. Stage 2 ([visual] unwrap) is by design redundant with stage 4 for well-formed
 * brackets (both yield the same inner prose), so no single assertion can isolate it — that's
 * defense-in-depth in the code, not a test gap: a refactor that drops BOTH bracket stages goes
 * RED. The [visual] assertions still pin the observable contract (brackets → clean prose).
 *
 * DISCOVERED, deliberately NOT fixed here (attended product fork): a ~~struck~~ trim span
 * (a real token form wrapToken emits and docToBlocks persists into b.text) is NOT stripped —
 * its ~~ markers leak into the handoff verbatim. Whether a producer handoff should show the
 * struck words as plain prose, drop them entirely, or keep the strike is a taste/product call
 * (trim spans mark words for REMOVAL, which cuts against the tool's keep-every-word law), so
 * it's left for an attended decision rather than guessed. The assertion at the bottom PINS the
 * current (leaking) behavior so a future change to it is a conscious, tested edit — not drift.
 */
import { stripSpanScaffolding } from './document-builder.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};

// ── Stage 1: {tk …}/{fc …}/{fact …} brace tokens → inner text (keyword + braces dropped) ──
// This is the load-bearing case: a producer reading a SOT quote must see the words, never the
// "{tk …}" writing-ask markup the editor left in. Neutering the brace-token replace leaves the
// whole "{tk …}" in place → these go RED.
eq(stripSpanScaffolding('{tk fractured shape}'), 'fractured shape', 'tk token → inner prose');
eq(stripSpanScaffolding('{fc verify this}'), 'verify this', 'fc token → inner prose');
eq(stripSpanScaffolding('{fact check claim}'), 'check claim', 'fact token → inner prose');
eq(stripSpanScaffolding('{TK SHOUT}'), 'SHOUT', 'brace-token match is case-insensitive');
// multiple spans in ONE body all unwrap; surrounding prose is untouched
eq(stripSpanScaffolding('She {tk one fifth} of {fc land area} here'),
   'She one fifth of land area here', 'multiple brace tokens in one line all unwrap');
// a broadcast timecode INSIDE a span is KEPT (the [^{}] inner capture spans it) — editors
// live by timecodes, so the handoff must not eat one that sat inside a {tk …}
eq(stripSpanScaffolding('inside {tk with 00:09:19:03 code}'),
   'inside with 00:09:19:03 code', 'timecode embedded in a brace token survives the unwrap');

// ── Stage 2: [visual …] brackets → inner text ───────────────────────────────────────────
// Visual-direction spans are ALSO markup the producer shouldn't see wrapped. Neutering the
// bracket replace leaves "[…]" → RED.
eq(stripSpanScaffolding('[highlights India]'), 'highlights India', 'visual bracket → inner prose');
eq(stripSpanScaffolding('B roll [river DAY 2 00:09:19:03]'),
   'B roll river DAY 2 00:09:19:03', 'bracket unwrap keeps an embedded timecode');

// ── Stage 3: UNTERMINATED span scaffolding is peeled ────────────────────────────────────
// The parser sometimes hands a span with no closing brace ("{tk note that runs to EOL"). The
// balanced brace-token replace can't match it, so a dedicated peel drops the bare "{tk " opener.
// Neutering the unterminated-'{tk' peel leaves "{tk note …" → RED (this asserts the peeled form,
// distinguishing it from Stage 1 which can't fire on the unbalanced input).
eq(stripSpanScaffolding('{tk note that runs to EOL with no close'),
   'note that runs to EOL with no close', 'unterminated {tk opener is peeled off');

// ── Stage 4: any STRAY lone brace/bracket is removed ────────────────────────────────────
// Belt-and-suspenders: after the structured unwraps, no lone { } [ ] may reach the handoff.
// Neutering the lone-char strip leaves the stray glyphs → RED.
eq(stripSpanScaffolding('stray { brace and ] bracket'), 'stray brace and bracket',
   'lone stray brace + bracket are removed');
eq(stripSpanScaffolding('nested [a [b] c]'), 'nested a b c', 'nested brackets fully unwrap');
eq(stripSpanScaffolding('{}'), '', 'empty braces collapse to nothing');

// ── whitespace hygiene + null-safety (matches cleanQuote/clean contract) ────────────────
eq(stripSpanScaffolding('  {tk pad}   tail  '), 'pad tail',
   'runs of whitespace collapse and ends are trimmed');
eq(stripSpanScaffolding('plain line no markup'), 'plain line no markup',
   'markup-free prose passes through unchanged');
eq(stripSpanScaffolding(''), '', 'empty string → empty string');
eq(stripSpanScaffolding(null), '', 'null → empty string (no throw)');
eq(stripSpanScaffolding(undefined), '', 'undefined → empty string (no throw)');

// ── PIN the known ~~trim span~~ gap (see header) — current behavior: markers leak verbatim.
// This is a REGRESSION PIN, not an endorsement: if/when the attended product call is made,
// this line changes deliberately with the fix.
eq(stripSpanScaffolding('~~struck words~~ stay?'), '~~struck words~~ stay?',
   'KNOWN GAP (pinned): ~~trim span~~ markers are not stripped — attended product call');

console.log(`strip-span-scaffolding: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
