// Locks audiobookFullyDownloaded(), the completeness gate for the BERGUNDY
// reader's "download the audiobook" feature (public/burgundy/index.html,
// commit 7b91ab5). Extracted from the shipped HTML at runtime so a drift in
// index.html breaks this test.
//
// Bug fixed + locked here: the download click loop resolves every paragraph's
// audio URL under `try { urls.push(await urlFor(i)); } catch {}`, so a transient
// TTS failure SILENTLY drops that paragraph from the list handed to the service
// worker. The SW then reports its progress against `urls.length` (the RESOLVED
// count), not the true paragraph count. The old page code marked the book
// `bg-audiobook-done` whenever `!m.failed` — i.e. as long as every *resolved*
// file downloaded clean — so one dropped resolution lit the green "✓⤓ audio
// downloaded — every night this week works offline" state while an audio gap sat
// silently in the middle of the book. The fix compares the SW-reported total
// against the TRUE paragraph count (dl.expected) and refuses to persist "done"
// unless every paragraph both resolved and fetched clean. Re-tapping then
// self-heals (urlFor retries the previously-failed paragraphs).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');
const m = html.match(/function audiobookFullyDownloaded\(reportedTotal, expected, failed\)\s*\{[\s\S]*?\n\}/);
assert.ok(m, 'could not extract audiobookFullyDownloaded() from index.html — did the signature change?');
const audiobookFullyDownloaded = (0, eval)('(' + m[0] + ')');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; };

// ── 1. the happy path: every paragraph resolved AND downloaded ───────────────
ok(audiobookFullyDownloaded(200, 200, 0) === true, 'all 200 resolved + downloaded → complete');
ok(audiobookFullyDownloaded(1, 1, 0) === true, 'a one-paragraph book that fully downloaded → complete');

// ── 2. the bug this locks: a SILENTLY-DROPPED resolution must NOT read complete ─
// 200 paragraphs, but one TTS resolution failed in the click loop → the SW only
// ever saw 199 URLs, downloaded all 199 clean (failed=0). The OLD code marked
// this "done". It must NOT.
ok(audiobookFullyDownloaded(199, 200, 0) === false, 'one dropped resolution (199/200, 0 dl-failures) → NOT complete');
ok(audiobookFullyDownloaded(150, 200, 0) === false, '50 dropped resolutions → NOT complete');
ok(audiobookFullyDownloaded(0, 200, 0) === false, 'offline / nothing resolved → NOT complete');

// ── 3. download failures inside the SW also block "done" ─────────────────────
ok(audiobookFullyDownloaded(200, 200, 1) === false, 'all resolved but one SW fetch failed → NOT complete');
ok(audiobookFullyDownloaded(200, 200, 12) === false, 'many SW fetch failures → NOT complete');

// ── 4. an empty book never falsely claims a downloaded audiobook ─────────────
ok(audiobookFullyDownloaded(0, 0, 0) === false, 'zero-paragraph book → NOT marked as a downloaded audiobook');

// ── 5. defensive: reportedTotal overshooting expected still counts (dup URLs) ──
// identical paragraphs resolve to the same content-hashed URL; the count still
// aligns per-index, but guard against an off-by-one reading as incomplete.
ok(audiobookFullyDownloaded(201, 200, 0) === true, 'reportedTotal >= expected still complete (>=, not ===)');

// ── MUTATION PROOF ───────────────────────────────────────────────────────────
// Reconstruct the OLD (buggy) predicate — "done as long as no SW download
// failed", ignoring dropped resolutions — and prove it lit green on the exact
// silent-gap case the fix rejects.
const oldBuggy = (reportedTotal, expected, failed) => !failed;
assert.equal(oldBuggy(199, 200, 0), true, 'sanity: the OLD code WOULD have marked a 199/200 partial as done');
assert.equal(audiobookFullyDownloaded(199, 200, 0), false, 'the FIX rejects the exact case the old code accepted');
pass += 2;

console.log(`audiobook-complete-guard: ${pass} assertions passed`);
