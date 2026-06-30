// Lock the tus-fingerprint eviction predicate (extracted from db.js's
// clearTusFingerprint loop, commit 0ff604e). This decides which poisoned tus
// resume records get nuked on an upload retry. Two failure modes it must guard:
//   - too NARROW → the wedged file's poison survives, retry stays stuck at 0%;
//   - too WIDE  → a DIFFERENT live upload's fingerprint is evicted, wedging it.
//
// Run: node translation/src/tus-fingerprint.test.mjs

import { makeFileNameNeedle, matchesTusFingerprintKey } from './tus-fingerprint.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const ENDPOINT = 'https://abc.supabase.co/storage/v1/upload/resumable';
const PATH = 'uploads/proj1/KENLY interview.mov';

// Realistic context for a retry of "KENLY interview.mov".
const ctx = {
  path: PATH,
  bucket: 'media',
  endpoint: ENDPOINT,
  fileNameNeedle: makeFileNameNeedle('KENLY interview.mov'),
  staleUploadUrl: null,
};

// ── makeFileNameNeedle ────────────────────────────────────────────────
eq(makeFileNameNeedle('KENLY interview.mov'), 'kenlyinterview.mov', 'needle: lowercase + strip spaces');
eq(makeFileNameNeedle('A (Final) cut!.mp4'), 'afinalcut.mp4', 'needle: strip parens/space/bang, keep dot');
eq(makeFileNameNeedle('my-file_01.MOV'), 'my-file_01.mov', 'needle: keep hyphen/underscore/dot, lowercase');
eq(makeFileNameNeedle(null), '', 'needle: null → empty');
eq(makeFileNameNeedle(undefined), '', 'needle: undefined → empty');

// ── rung 1: exact object-path match ───────────────────────────────────
eq(
  matchesTusFingerprintKey('tus::media-xyz', { metadata: { objectName: PATH } }, ctx),
  true,
  'exact objectName === path evicts',
);
eq(
  matchesTusFingerprintKey('tus::media-xyz', { metadata: { objectName: 'uploads/proj1/OTHER.mov' } }, ctx),
  false,
  'different objectName (no needle hit) is NOT evicted',
);

// ── rung 2: fuzzy needle + bucket/endpoint agreement ──────────────────
eq(
  matchesTusFingerprintKey(
    'tus::kenlyinterview.mov-blah',
    { metadata: { bucketName: 'media' }, uploadUrl: 'https://other/x' },
    ctx,
  ),
  true,
  'needle in key + matching bucket evicts',
);
eq(
  matchesTusFingerprintKey(
    'tus::session-7',
    // tus fingerprints embed a sanitized (space-stripped) name, which is what
    // the needle is built to match — a raw spaced name would NOT substring-hit.
    { fingerprint: 'kenlyinterview.mov-1024-video/quicktime', uploadUrl: ENDPOINT + '/sess7' },
    ctx,
  ),
  true,
  'needle in fingerprint + uploadUrl on endpoint evicts',
);
// Document the real limitation: a fingerprint that keeps spaces won't fuzzy-hit
// the space-stripped needle (only the exact-path rung 1 would catch that file).
eq(
  matchesTusFingerprintKey(
    'tus::sess8',
    { fingerprint: 'KENLY interview.mov-1024-video/quicktime', uploadUrl: ENDPOINT + '/sess8' },
    ctx,
  ),
  false,
  'spaced fingerprint does not fuzzy-match the stripped needle (rung-2 limitation)',
);
eq(
  matchesTusFingerprintKey(
    'tus::' + ENDPOINT + '::kenlyinterview.mov',
    { metadata: {} },
    ctx,
  ),
  true,
  'needle in key + endpoint substring in key evicts',
);
// Needle present but NOTHING agrees on bucket/endpoint → too loose, keep it.
eq(
  matchesTusFingerprintKey(
    'tus::kenlyinterview.mov-stray',
    { metadata: { bucketName: 'avatars' }, uploadUrl: 'https://elsewhere/v1/up' },
    ctx,
  ),
  false,
  'needle alone (wrong bucket, off-endpoint url, no endpoint in key) is NOT evicted',
);

// ── rung 3: explicit stale uploadUrl force-evict ──────────────────────
const STALE = ENDPOINT + '/dead-session-42';
eq(
  matchesTusFingerprintKey(
    'tus::unrelated',
    { metadata: { objectName: 'uploads/proj9/somethingelse.mp4' }, uploadUrl: STALE },
    { ...ctx, staleUploadUrl: STALE },
  ),
  true,
  'matching staleUploadUrl evicts even with unrelated objectName',
);
eq(
  matchesTusFingerprintKey(
    'tus::unrelated',
    { metadata: { objectName: 'uploads/proj9/somethingelse.mp4' }, uploadUrl: ENDPOINT + '/live-other' },
    { ...ctx, staleUploadUrl: STALE },
  ),
  false,
  'non-matching uploadUrl with stale set is NOT evicted (protects other live uploads)',
);

// ── guards: non-tus keys, junk values ─────────────────────────────────
eq(matchesTusFingerprintKey('not-a-tus-key', { metadata: { objectName: PATH } }, ctx), false, 'non tus:: prefix ignored');
eq(matchesTusFingerprintKey('tus::x', null, ctx), false, 'null parsed value → no match');
eq(matchesTusFingerprintKey('tus::x', {}, ctx), false, 'empty object → no match');
eq(matchesTusFingerprintKey('tus::x', { metadata: null }, ctx), false, 'null metadata → no match');
eq(matchesTusFingerprintKey(null, { metadata: { objectName: PATH } }, ctx), false, 'non-string key → no match');
// Empty needle must not let everything through the fuzzy rung.
eq(
  matchesTusFingerprintKey('tus::anything', { metadata: { bucketName: 'media' } }, { ...ctx, fileNameNeedle: '' }),
  false,
  'empty needle does not fuzzy-match every record',
);

// ── MUTATION PROOFS — these distinguish the real predicate from broken ones ──
// If rung 2 dropped its bucket/endpoint AND-guard (matched on needle alone),
// the "stray wrong-bucket" record above would wrongly evict. Assert it doesn't:
eq(
  matchesTusFingerprintKey(
    'tus::kenlyinterview.mov-stray',
    { metadata: { bucketName: 'avatars' }, uploadUrl: 'https://elsewhere/v1/up' },
    ctx,
  ),
  false,
  'MUTATION GUARD: needle-only match (no bucket/endpoint agreement) must stay false',
);
// If rung 3 used loose truthiness instead of === on uploadUrl, an unrelated
// live session would be evicted. Assert exact-equality discipline:
eq(
  matchesTusFingerprintKey(
    'tus::live',
    { uploadUrl: ENDPOINT + '/some-OTHER-live-session' },
    { ...ctx, staleUploadUrl: STALE },
  ),
  false,
  'MUTATION GUARD: stale rung requires exact uploadUrl equality, not truthiness',
);

console.log(`tus-fingerprint: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
