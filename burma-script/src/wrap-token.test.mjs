/**
 * wrap-token.test.mjs — locks wrapToken, the EXPORT serializer that re-wraps Burma
 * Script inline span marks back into their {tk …} / {fc …} / […] tokens for the
 * blocks export / round-trip view (document-builder.docToBlocks → nodeText → wrapToken).
 *
 * Why a DIRECT lock when nodeText already covers it indirectly: nodeText's tests
 * exercise only a couple of wrapToken paths (a braced tk span; a bare tk span; a
 * bracketed visual span). The SUBTLE, regression-prone branches are untested in
 * isolation:
 *   • keyword-dedup — text that ALREADY starts with the keyword (tk / fc / fact)
 *     must NOT get the keyword re-prepended, or Johnny's exported worklist tokens
 *     become "{tk tk foo}" / "{fc fc bar}" double-keyword garbage.
 *   • already-braced / already-bracketed passthrough — content the bubble menu
 *     already wrapped must round-trip byte-identical (no double-wrap "{{…}}").
 *   • factCheckSpan + bare visualSpan have NO direct coverage at all.
 *
 * A refactor that breaks any of these silently corrupts the EXPORT view of his
 * flagship project. This file pins them; the assertions below are mutation-proven
 * (neutering the keyword-dedup or the already-braced guard turns specific lines RED).
 */
import { wrapToken } from './document-builder.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};

// ── tkSpan ────────────────────────────────────────────────────────────────────
// bare text (no keyword, no braces) → wrap with keyword
eq(wrapToken('fractured shape', 'tkSpan'), '{tk fractured shape}', 'tk bare text gets {tk …}');
// KEYWORD-DEDUP: text already begins with "tk" → do NOT double-add the keyword
eq(wrapToken('tk fractured shape', 'tkSpan'), '{tk fractured shape}', 'tk keyword not doubled (lowercase)');
eq(wrapToken('TK SHOUT', 'tkSpan'), '{TK SHOUT}', 'tk keyword dedup is case-insensitive');
// "tk" must be a WHOLE word — "tkachev" is a name, not the keyword → keyword added
eq(wrapToken('tkachev story', 'tkSpan'), '{tk tkachev story}', 'tk\\b boundary: "tkachev" is not the keyword');
// already braced → passthrough byte-identical (incl. surrounding whitespace preserved)
eq(wrapToken('{tk already}', 'tkSpan'), '{tk already}', 'tk already-braced passthrough');
eq(wrapToken('  {tk pad}  ', 'tkSpan'), '  {tk pad}  ', 'tk already-braced keeps surrounding whitespace');
// leading/trailing whitespace on bare text is trimmed before wrapping
eq(wrapToken('   shape   ', 'tkSpan'), '{tk shape}', 'tk bare text is trimmed inside the braces');

// ── factCheckSpan ───────────────────────────────────────────────────────────── (no prior direct coverage)
eq(wrapToken('verify this', 'factCheckSpan'), '{fc verify this}', 'fc bare text gets {fc …}');
eq(wrapToken('fc verify this', 'factCheckSpan'), '{fc verify this}', 'fc keyword not doubled');
eq(wrapToken('fact check claim', 'factCheckSpan'), '{fact check claim}', '"fact" keyword variant not doubled');
eq(wrapToken('factory tour', 'factCheckSpan'), '{fc factory tour}', 'fc\\b boundary: "factory" is not the keyword');
eq(wrapToken('{fc kept}', 'factCheckSpan'), '{fc kept}', 'fc already-braced passthrough');

// ── visualSpan ──────────────────────────────────────────────────────────────── (bare case had no direct coverage)
eq(wrapToken('shot of river', 'visualSpan'), '[shot of river]', 'visual bare text gets [ … ]');
eq(wrapToken('[highlights India]', 'visualSpan'), '[highlights India]', 'visual already-bracketed passthrough');
eq(wrapToken('   wide drone shot   ', 'visualSpan'), '[wide drone shot]', 'visual bare text is trimmed inside the brackets');

// ── unknown / null kind ─────────────────────────────────────────────────────── (plain text falls through)
eq(wrapToken('plain words', null), 'plain words', 'null kind returns text unchanged');
eq(wrapToken('plain words', 'somethingElse'), 'plain words', 'unknown kind returns text unchanged');

console.log(`wrap-token: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
