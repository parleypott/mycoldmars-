// Locks the gapless-audio BLOB EVICTION WINDOW added to the BURGUNDY reader
// (public/burgundy/index.html, commit 2890b7e "gapless audio — buffer mp3 bytes
// 3 paras ahead").
//
// WHAT THE COMMIT DOES: the player used to set <audio>.src to a resolved URL, so
// every paragraph opened with a network+decode stall (the "couple-second gap").
// blobFor() now fetches the actual mp3 BYTES ahead of the play head into object
// URLs (blobs Map: key -> Promise<objectURL>) so the next paragraph plays instantly.
// A 1,100-paragraph book can't pile the whole audiobook into memory, so evictBlobs(i)
// keeps a small window of object URLs warm around the play head and URL.revokeObjectURL()s
// the rest.
//
// THE LOAD-BEARING INVARIANT this pins: evictBlobs MUST keep the key for the
// CURRENTLY-PLAYING paragraph (n === 0). startAt(i) sets `tts.src` to blobFor(i)'s
// object URL, then calls evictBlobs(i) with the SAME i — so if the keep window ever
// stopped spanning n=0 (e.g. a refactor changing `n = -1` to `n = 1`), it would
// revoke the object URL still wired into <audio>.src and BREAK playback mid-paragraph
// — a worse regression than the gap the commit fixes. The window also must include
// the PREFETCH_AHEAD paragraphs warmed just above (n = 1..PREFETCH_AHEAD) so they
// aren't fetched then immediately freed, and must EVICT everything far from the head
// so the memory bound the commit exists to enforce actually holds.
//
// This test does two things:
//  (1) SOURCE-LOCK: asserts the shipped evictBlobs() keep loop still spans n = -1 ..
//      PREFETCH_AHEAD + 1 (which includes n === 0), and still revokes non-kept blobs.
//  (2) BEHAVIOR + MUTATION: models the eviction rule as a pure function of (head, flat,
//      buffered-keys) and proves the shipped window keeps the current + prefetched keys
//      and evicts the rest — while a mutated window that starts at n = 1 REVOKES the
//      currently-playing key (the exact break the source-lock guards).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf8');

// ── (1) SOURCE-LOCK ────────────────────────────────────────────────────────────
const fn = html.match(/function evictBlobs\(i\)\s*\{[\s\S]*?\n\}/);
assert.ok(fn, 'could not extract evictBlobs(i) — did the function signature change?');

// PREFETCH_AHEAD constant present and >= 1 (must warm at least the next paragraph).
const pa = html.match(/const PREFETCH_AHEAD\s*=\s*(\d+)\s*;/);
assert.ok(pa, 'PREFETCH_AHEAD constant missing');
const PREFETCH_AHEAD = Number(pa[1]);
assert.ok(PREFETCH_AHEAD >= 1, `PREFETCH_AHEAD must be >= 1 (was ${PREFETCH_AHEAD})`);

// The keep loop MUST start at n = -1 and run through PREFETCH_AHEAD + 1 — that range
// spans n === 0 (the currently-playing paragraph), which must never be revoked.
assert.match(
  fn[0],
  /for \(let n = -1; n <= PREFETCH_AHEAD \+ 1; n\+\+\)\s*\{[\s\S]*?keep\.add\(u\.key\)/,
  'evictBlobs keep loop must span n = -1 .. PREFETCH_AHEAD + 1 (includes the current paragraph, n=0)'
);
// And it must actually free non-kept blobs (the memory bound the commit exists for).
assert.match(
  fn[0],
  /if \(keep\.has\(key\)\) continue;[\s\S]*?blobs\.delete\(key\);[\s\S]*?revokeObjectURL/,
  'evictBlobs must delete + URL.revokeObjectURL() every blob outside the keep window'
);

// ── (2) BEHAVIOR + MUTATION ──────────────────────────────────────────────────────
// Model the eviction as a pure function. `flat` is the paragraph list (each has .key);
// `buffered` is the set of keys currently in the blobs Map. Returns { kept, revoked }
// key sets. `lo` is the loop's lower bound (the shipped code uses -1).
function evict(head, flat, buffered, lo = -1) {
  const keep = new Set();
  for (let n = lo; n <= PREFETCH_AHEAD + 1; n++) {
    const u = flat[head + n];
    if (u) keep.add(u.key);
  }
  const kept = new Set(), revoked = new Set();
  for (const key of buffered) (keep.has(key) ? kept : revoked).add(key);
  return { kept, revoked };
}

// A 1,100-paragraph book with everything buffered (the worst case the window bounds).
const flat = Array.from({ length: 1100 }, (_, k) => ({ key: `p:${k}` }));
const allKeys = new Set(flat.map(u => u.key));

// Play head parked mid-book at paragraph 500.
const head = 500;
const shipped = evict(head, flat, allKeys, -1);

// The currently-playing paragraph's key is ALWAYS kept — never revoked.
assert.ok(shipped.kept.has('p:500'), 'the currently-playing blob (head, n=0) must be KEPT');
assert.ok(!shipped.revoked.has('p:500'), 'the currently-playing blob must never be revoked');

// The just-finished paragraph (n=-1) stays one step (smooth backward scrub / no re-fetch).
assert.ok(shipped.kept.has('p:499'), 'the previous paragraph (n=-1) is kept');

// Every PREFETCH_AHEAD paragraph warmed just above the head is kept (not freed then re-fetched).
for (let n = 1; n <= PREFETCH_AHEAD; n++) {
  assert.ok(shipped.kept.has(`p:${500 + n}`), `prefetched paragraph n=${n} must be kept`);
}

// The window is BOUNDED — everything far from the head is evicted, so memory can't balloon.
assert.ok(shipped.revoked.has('p:0'), 'far-behind blob must be evicted');
assert.ok(shipped.revoked.has('p:1099'), 'far-ahead blob must be evicted');
// Exactly the window [head-1 .. head+PREFETCH_AHEAD+1] survives (bounded, not O(book)).
assert.equal(shipped.kept.size, PREFETCH_AHEAD + 3,
  `keep window must be a small constant (PREFETCH_AHEAD + 3 = ${PREFETCH_AHEAD + 3}), not the whole book`);
assert.equal(shipped.kept.size + shipped.revoked.size, allKeys.size, 'every buffered key is either kept or revoked');

// Out-of-range head (near the end) adds no junk keys — the window clips to real paragraphs.
const tail = evict(1099, flat, allKeys, -1);
assert.ok(tail.kept.has('p:1099'), 'last paragraph kept when it is the head');
assert.ok(!tail.kept.has('p:1100'), 'no phantom key past the end of the book');

// MUTATION ORACLE: a window that starts at n = 1 (the plausible off-by-one a refactor
// could introduce) drops the currently-playing paragraph — proving the n=-1 start / n=0
// coverage the source-lock pins is load-bearing, not decorative.
const buggy = evict(head, flat, allKeys, 1);
assert.ok(buggy.revoked.has('p:500'),
  'a keep window starting at n=1 REVOKES the currently-playing blob — the break the source-lock guards');
assert.ok(!buggy.kept.has('p:500'), 'the buggy window does not keep the current paragraph');

console.log('evict-blobs-window: all assertions passed');
