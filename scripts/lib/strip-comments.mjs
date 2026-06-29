// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/strip-comments.mjs — SHARED regex-aware comment/string blanker.
//
// One source of truth for every ledger-backed gate scanner (find-divide-by-length,
// find-truthy-zero, find-tz-date-drift, find-unguarded-decode,
// find-wrongtype-json-parse, find-dynamic-regex, find-spread-overflow). Each gate
// used to hand-copy this; the copies drifted, and the pre-regex-aware copies carried
// a latent FALSE-NEGATIVE soundness hole (see the REGEX-LITERAL HANDLING note below).
// Importing this one proven copy makes every gate the STRONGER one and kills the
// divergence for good. Self-test: scripts/lib/strip-comments.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

// Blank out comments AND non-code string text by overwriting their characters
// with spaces — preserves every byte offset so line numbers stay exact, but
// stops a `Math.max(...x)` inside a docstring or a string literal from polluting
// the ledger. Single/double-quoted strings are blanked whole; TEMPLATE literals
// keep their `${...}` expression contents and blank only the literal text.
//
// REGEX-LITERAL HANDLING (load-bearing for soundness). A naive blanker that
// ignores regex literals DESYNCS catastrophically: a regex whose body holds a
// quote — `.replace(/_Proxy\.MP4$/i, '')`, `/['"]/`, `str.split(/[,;]/)` — makes
// the lexer treat that inner quote as a string opener and run away, blanking
// every byte until the next matching quote far downstream. For a GATE that is a
// silent FALSE NEGATIVE: it would blank — and therefore miss — a real
// `Math.max(...userArray)` that lives past the runaway (this exact desync hid
// the hunter/src/main.js sites in the first cut). So we disambiguate `/` as
// divide-vs-regex using the standard rule: a `/` is DIVISION when the last
// significant code char is a value-ender (ident / `)` / `]` / `}` / `.` / digit),
// else it opens a REGEX literal, which we consume (honoring `\` escapes and
// `[...]` char classes so a `/` inside a class doesn't end it early).
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let lastSig = ''; // last significant (non-ws) CODE char — drives divide-vs-regex
  const blank = (j) => { if (src[j] !== '\n') out[j] = ' '; };
  const DIVIDE_CTX = /[A-Za-z0-9_$)\].]/; // value-enders: `/` after these is division
  const eatQuote = (q) => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === q) { blank(i); i++; return; }
      blank(i); i++;
    }
  };
  const eatRegex = () => {
    blank(i); i++; // opening `/`
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\n') return;       // unterminated — regex can't span a line; bail
      if (c === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (c === '[') { inClass = true; blank(i); i++; continue; }
      if (c === ']') { inClass = false; blank(i); i++; continue; }
      if (c === '/' && !inClass) { blank(i); i++; break; } // closing `/`
      blank(i); i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) { blank(i); i++; } // flags
  };
  const eatTemplate = () => {
    blank(i); i++;
    while (i < n) {
      if (src[i] === '\\') { blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === '`') { blank(i); i++; return; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const c = src[i], nx = src[i + 1];
          if (c === '"' || c === "'") { eatQuote(c); continue; }
          if (c === '`') { eatTemplate(); continue; }
          if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
          if (c === '/' && nx === '*') { blank(i); blank(i + 1); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; } if (i < n) { blank(i); blank(i + 1); i += 2; } continue; }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          if (depth > 0) i++;
        }
        if (i < n) i++;
        continue;
      }
      blank(i); i++;
    }
  };
  while (i < n) {
    const c = src[i], nx = src[i + 1];
    if (c === '"' || c === "'") { eatQuote(c); lastSig = ')'; continue; } // string is a value
    if (c === '`') { eatTemplate(); lastSig = ')'; continue; }
    if (c === '/' && nx === '/') { while (i < n && src[i] !== '\n') { blank(i); i++; } continue; }
    if (c === '/' && nx === '*') {
      blank(i); blank(i + 1); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { blank(i); i++; }
      if (i < n) { blank(i); blank(i + 1); i += 2; }
      continue;
    }
    if (c === '/') {
      if (DIVIDE_CTX.test(lastSig)) { lastSig = '/'; i++; }   // division — leave intact
      else { eatRegex(); lastSig = ')'; }                     // regex literal — blank it
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}
