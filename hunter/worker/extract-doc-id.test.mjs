// Mutation-lock for extractDocId — the canonical Google-Docs URL → doc-ID parser
// in google-docs-client.js. It decides WHICH of Johnny's Google Docs scripts the
// Hunter worker fetches + ingests into the corpus: a wrong ID = the wrong script
// ingested, silently. It had ZERO coverage, and ingest.js carried a byte-identical
// LOCAL shadow copy (since deleted) that would have defeated any hardening of this
// one. This lock freezes the contract on the single surviving copy.
//
// Load-bearing assertions (each goes RED under a realistic regression):
//   • pulls the id out of a standard /document/d/<id>/edit URL
//   • the id charset is [A-Za-z0-9_-] and stops at the next '/' (no greedy grab of /edit)
//   • throws (never returns a wrong/blank id) when there is no /document/d/ segment
//
// Run: node hunter/worker/extract-doc-id.test.mjs

import { extractDocId } from './google-docs-client.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const throws = (fn, msg) => {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (threw) { pass++; }
  else { fail++; console.error(`FAIL (expected throw): ${msg}`); }
};

const ID = '1AbC_dEf-2GhIjKlMnOpQrStUvWxYz0123456789';

// ── Standard edit URL ──
eq(extractDocId(`https://docs.google.com/document/d/${ID}/edit`), ID,
   'standard /document/d/<id>/edit');
eq(extractDocId(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`), ID,
   'edit URL with query string');
eq(extractDocId(`https://docs.google.com/document/d/${ID}/edit#gid=0`), ID,
   'edit URL with fragment');

// ── Trailing forms that must NOT swallow the next path segment ──
eq(extractDocId(`https://docs.google.com/document/d/${ID}/export?format=txt`), ID,
   'export URL — id stops before /export (greedy-grab canary)');
eq(extractDocId(`https://docs.google.com/document/d/${ID}`), ID,
   'bare /document/d/<id> with no trailing slash');
eq(extractDocId(`https://docs.google.com/document/d/${ID}/`), ID,
   'trailing slash only');

// ── Charset boundary: id is exactly the [A-Za-z0-9_-] run ──
// underscores and hyphens are part of the id; the next '/' or '?' terminates it.
eq(extractDocId('https://docs.google.com/document/d/a_b-c/edit'), 'a_b-c',
   'underscore + hyphen are id chars');

// ── No valid segment → must THROW, never return a wrong/empty id ──
throws(() => extractDocId('https://docs.google.com/spreadsheets/d/xyz/edit'),
   'a Sheets URL has no /document/d/ — must throw');
throws(() => extractDocId('https://example.com/not-a-doc'),
   'unrelated URL must throw');
throws(() => extractDocId('just some text'),
   'plain text must throw');
throws(() => extractDocId('https://docs.google.com/document/d//edit'),
   'empty id segment must throw (no match, not a blank id)');

console.log(`extract-doc-id: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
