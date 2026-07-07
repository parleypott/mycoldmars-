// version-beacon.test.mjs — the stale-bundle detector's pure parts (version-beacon.js).
// The beacon kills the "broken here, fine in a private window" symptom class: a long-lived
// tab running yesterday's bundle. Run: bun src/version-beacon.test.mjs

import assert from 'node:assert/strict';
import { extractBundleSignature, nextBeaconState, probeBundleSignature } from './version-beacon.js';

let pass = 0;
const ok = async (label, fn) => { await fn(); pass++; console.log('  ✓ ' + label); };

const HTML_V1 = `<!doctype html><html><head>
  <script type="module" crossorigin src="/scripts-library/assets/index-B2kF9x.js"></script>
  <link rel="modulepreload" href="/scripts-library/assets/vendor-Ck2P0q.js">
  <link rel="stylesheet" href="/scripts-library/assets/index-D3xx.css">
</head><body></body></html>`;
const HTML_V2 = HTML_V1.replace('index-B2kF9x.js', 'index-NEW999.js');

ok('signature = sorted /assets/*.js paths; CSS and markup ignored; stable across duplicates', () => {
  const sig = extractBundleSignature(HTML_V1);
  assert.equal(sig, '/assets/index-B2kF9x.js|/assets/vendor-Ck2P0q.js');
  assert.equal(extractBundleSignature(HTML_V1 + HTML_V1), sig, 'deduped');
});

ok('relative and absolute asset references produce the same signature', () => {
  const rel = HTML_V1.replaceAll('/scripts-library/assets/', './assets/');
  assert.equal(extractBundleSignature(rel), extractBundleSignature(HTML_V1));
});

ok('a deploy (any hashed chunk change) changes the signature', () => {
  assert.notEqual(extractBundleSignature(HTML_V1), extractBundleSignature(HTML_V2));
});

ok('tick logic: first good probe = baseline; same sig = calm; changed sig = stale; null never trips', () => {
  let s = nextBeaconState(null, null);
  assert.deepEqual(s, { baseline: null, stale: false }, 'null probe before baseline: no-op');
  s = nextBeaconState(null, 'A');
  assert.deepEqual(s, { baseline: 'A', stale: false }, 'first probe sets baseline, never stale');
  s = nextBeaconState('A', 'A');
  assert.deepEqual(s, { baseline: 'A', stale: false });
  s = nextBeaconState('A', null);
  assert.deepEqual(s, { baseline: 'A', stale: false }, 'failed probe: no false positive');
  s = nextBeaconState('A', 'B');
  assert.equal(s.stale, true, 'changed signature = a deploy landed');
});

await ok('probe: non-ok / throwing / assetless responses all resolve null (fail-safe)', async () => {
  const mk = (ok_, text) => async () => ({ ok: ok_, text: async () => text });
  assert.equal(await probeBundleSignature(mk(false, HTML_V1), '/x'), null);
  assert.equal(await probeBundleSignature(async () => { throw new Error('offline'); }, '/x'), null);
  assert.equal(await probeBundleSignature(mk(true, '<html>no assets</html>'), '/x'), null);
  assert.equal(await probeBundleSignature(mk(true, HTML_V1), '/x'), extractBundleSignature(HTML_V1));
});

console.log('version-beacon: ' + pass + '/5 passed');
