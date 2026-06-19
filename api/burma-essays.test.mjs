// Tests for burma-essays PostgREST filter escaping (security fix).
//
// burma-essays is a PUBLIC, no-auth reader endpoint that queries Supabase with
// the service-role key (RLS-bypassing). It built its essay/highlight query URLs
// by interpolating a caller-supplied id straight into `id=eq.${id}` /
// `essay_id=eq.${id}` at 8 sites — so an id containing `&` appended EXTRA query
// params onto a service-role read (e.g. `0&or=(id.gte.0)` broadens the filter),
// and the GET `?id=` path is reachable by any anonymous visitor. The shipped
// filter builders idEq()/essayIdEq() now route the id through pgrValue
// (encodeURIComponent), neutralizing the param separators. Same class as the
// devchat-respond fix (d13653f). These tests prove the breakout is closed and
// that escaping is a no-op for legitimate ids.
//
// Run: bun api/burma-essays.test.mjs   (also picked up by `bun run test`)

import assert from 'node:assert/strict';
import { pgrValue } from './_lib/pgrest.js';
import { idEq, essayIdEq } from './burma-essays.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };

const SUPA = 'https://example.supabase.co';
const REAL_UUID = '3f9a1c2e-7b4d-4e1a-9c8f-0a1b2c3d4e5f';

// The exact attack the fix exists to stop: an id that smuggles an extra
// `or=(...)` query param onto the service-role request to broaden the read.
const INJECT_OR = '0&or=(id.gte.0)';
// A select-override attempt (PostgREST resource embedding to reach another table).
const INJECT_SELECT = 'x&select=*,burma_essays(*)';
// Try to inject a leaked apikey / huge limit.
const INJECT_LIMIT = 'a&limit=99999';

// Build the two real query shapes from the source: an essay read and the
// highlight-by-essay read. These mirror the actual call sites in getOne().
const essayUrl  = (id) => `${SUPA}/rest/v1/burma_essays?${idEq(id)}&select=*`;
const highlightUrl = (id) => `${SUPA}/rest/v1/burma_highlights?${essayIdEq(id)}&select=id,quote&order=created_at.asc`;

// ── Inline RED proof: the OLD raw interpolation leaks the injected param ──
// Reconstruct exactly what the source did before the fix and prove an
// injection payload appends a real, separate query parameter.
const oldRawEssayUrl = (id) => `${SUPA}/rest/v1/burma_essays?id=eq.${id}&select=*`;
const oldRawHighlightUrl = (id) => `${SUPA}/rest/v1/burma_highlights?essay_id=eq.${id}&select=id,quote&order=created_at.asc`;

t('RED: old raw essay filter lets `or=` inject as a separate query param', () => {
  const u = new URL(oldRawEssayUrl(INJECT_OR));
  assert.equal(u.searchParams.has('or'), true);
  assert.equal(u.searchParams.get('or'), '(id.gte.0)');
  assert.equal(u.searchParams.get('id'), 'eq.0'); // id filter collapsed to eq.0
});
t('RED: old raw essay filter lets a `select` override inject', () => {
  const u = new URL(oldRawEssayUrl(INJECT_SELECT));
  assert.equal(u.searchParams.getAll('select').length, 2); // attacker added one
});
t('RED: old raw highlight filter lets `or=` inject', () => {
  const u = new URL(oldRawHighlightUrl(INJECT_OR));
  assert.equal(u.searchParams.has('or'), true);
});

// ── idEq / essayIdEq: the real shipped builders ──
t('idEq / essayIdEq produce the documented filter key', () => {
  assert.ok(idEq(REAL_UUID).startsWith('id=eq.'));
  assert.ok(essayIdEq(REAL_UUID).startsWith('essay_id=eq.'));
});

t('legit UUID round-trips verbatim through the essay filter (no-op)', () => {
  const u = new URL(essayUrl(REAL_UUID));
  assert.equal(u.searchParams.get('id'), `eq.${REAL_UUID}`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['id', 'select']);
});
t('legit UUID round-trips verbatim through the highlight filter (no-op)', () => {
  const u = new URL(highlightUrl(REAL_UUID));
  assert.equal(u.searchParams.get('essay_id'), `eq.${REAL_UUID}`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['essay_id', 'order', 'select']);
});
t('integer id is a no-op', () => {
  const u = new URL(essayUrl(12345));
  assert.equal(u.searchParams.get('id'), 'eq.12345');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['id', 'select']);
});

// ── GREEN: injections neutralized ──
t('GREEN: `or=` injection neutralized in the essay filter', () => {
  const u = new URL(essayUrl(INJECT_OR));
  assert.equal(u.searchParams.has('or'), false);             // no extra param
  assert.equal(u.searchParams.get('id'), `eq.${INJECT_OR}`); // whole payload is the literal value
  assert.deepEqual([...u.searchParams.keys()].sort(), ['id', 'select']);
});
t('GREEN: `or=` injection neutralized in the highlight filter', () => {
  const u = new URL(highlightUrl(INJECT_OR));
  assert.equal(u.searchParams.has('or'), false);
  assert.equal(u.searchParams.get('essay_id'), `eq.${INJECT_OR}`);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['essay_id', 'order', 'select']);
});
t('GREEN: `select` override neutralized — exactly one select param', () => {
  const u = new URL(essayUrl(INJECT_SELECT));
  assert.equal(u.searchParams.getAll('select').length, 1);
  assert.equal(u.searchParams.get('select'), '*');
  assert.equal(u.searchParams.get('id'), `eq.${INJECT_SELECT}`);
});
t('GREEN: `limit=` injection neutralized', () => {
  const u = new URL(essayUrl(INJECT_LIMIT));
  assert.equal(u.searchParams.has('limit'), false);
  assert.deepEqual([...u.searchParams.keys()].sort(), ['id', 'select']);
});

// ── Hard invariant: no caller-supplied id can add a query param ──
t('hard invariant: no id payload can add a query param to either filter', () => {
  const payloads = [
    INJECT_OR, INJECT_SELECT, INJECT_LIMIT,
    'b&id=eq.something', 'c&apikey=leak', 'd&or=(status.eq.x)&select=*',
    '&&&', 'x=y&z=w', REAL_UUID, '12', '',
  ];
  for (const p of payloads) {
    const ek = [...new URL(essayUrl(p)).searchParams.keys()].sort();
    const hk = [...new URL(highlightUrl(p)).searchParams.keys()].sort();
    assert.deepEqual(ek, ['id', 'select'], `essay keys for payload ${JSON.stringify(p)}`);
    assert.deepEqual(hk, ['essay_id', 'order', 'select'], `highlight keys for payload ${JSON.stringify(p)}`);
  }
});

t('null/undefined id yields an empty filter value, not "undefined"', () => {
  assert.equal(new URL(essayUrl(undefined)).searchParams.get('id'), 'eq.');
  assert.equal(new URL(essayUrl(null)).searchParams.get('id'), 'eq.');
});

// ── Source binding: the divergent raw interpolations are gone ──
// Strip comments, then assert every `eq.${...}` interpolation in the live source
// routes through pgrValue — i.e. no raw `eq.${id}` (the bug) survives.
t('source binding: no raw eq.${...} interpolation remains in burma-essays.js', async () => {
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = url.fileURLToPath(new URL('./burma-essays.js', import.meta.url));
  const src = fs.readFileSync(path, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // Every eq.${ in the (comment-stripped) source must be immediately followed by pgrValue(.
  const matches = [...src.matchAll(/eq\.\$\{([^}]*)\}/g)];
  assert.ok(matches.length >= 2, 'expected the idEq/essayIdEq builders to be present');
  for (const m of matches) {
    assert.ok(/^pgrValue\(/.test(m[1].trim()), `raw interpolation found: eq.\${${m[1]}}`);
  }
  // And pgrValue is actually imported.
  assert.ok(/import\s*\{[^}]*\bpgrValue\b[^}]*\}\s*from\s*['"]\.\/_lib\/pgrest\.js['"]/.test(src));
});

console.log(`\nburma-essays pgrest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
