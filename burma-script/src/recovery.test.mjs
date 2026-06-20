/**
 * STARTUP RECOVERY SURFACE — orphaned-snapshot discoverability (src/recovery.js).
 *
 * The gap: the adopt-cloud / cross-tab / 409 paths snapshot an unsynced local edit to a
 * .conflict.<ts> (or .bak.<ts>) recovery key and THEN reload — destroying the React banner that
 * pointed at it. The bytes survive on disk but are reachable only via DevTools, which a dyslexic
 * non-coder will never open. recovery.js scans localStorage at startup and surfaces those snapshots
 * so they can be previewed/downloaded. These tests prove the scan finds the right keys, orders them
 * newest-first, parses timestamps from both key forms, respects dismissals, and that the text
 * extractor flattens a ProseMirror doc to readable plain text — all without losing anything.
 *
 * Run: bun src/recovery.test.mjs   (auto-discovered by `bun run test`)
 */

// Fake localStorage with insertion-ordered keys (real localStorage is unordered, but the scan must
// not depend on order — it sorts by timestamp itself, which we verify below).
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    _map: map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}

const {
  scanRecoverySnapshots, readSnapshot, snapshotToText, dismissSnapshot, snapshotTimestamp,
  LS_DOC, CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX, LS_DISMISSED,
} = await import('./recovery.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(got === want, `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

const DOC = (t) => JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });

/* ── timestamp parsing: both the new "ms-seq" form and the old "ms" form ── */
{
  eq(snapshotTimestamp(CONFLICT_PREFIX + '1718800000000-000007'), 1718800000000, 'T1. parses ms from ms-seq form');
  eq(snapshotTimestamp(BAK_PREFIX + '1718800000000'), 1718800000000, 'T2. parses ms from bare-ms form');
  eq(snapshotTimestamp('garbage'), 0, 'T3. unparseable -> 0 (never throws)');
}

/* ── the scan finds .conflict + .bak + .corrupt, newest first, and ignores the live doc ── */
{
  const storage = makeStorage({
    [LS_DOC]: DOC('live doc on screen'),                          // must NOT be surfaced
    'wp01_burma_doc_ver_v1': '8|tabX',                            // not a snapshot
    'wp01.controls.v1': '{}',                                     // unrelated key
    [CONFLICT_PREFIX + '1000-000000']: DOC('older conflict'),
    [CONFLICT_PREFIX + '3000-000000']: DOC('newest conflict'),
    [BAK_PREFIX + '2000']: DOC('a backup'),
    [CORRUPT_PREFIX + '500']: DOC('a corrupt-recovery'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 4, 'S1. found exactly the 4 recovery snapshots (live doc + unrelated keys excluded)');
  eq(snaps[0].ts, 3000, 'S2. newest first');
  eq(snaps[1].ts, 2000, 'S3. then next-newest');
  eq(snaps[2].ts, 1000, 'S4. then older');
  eq(snaps[3].ts, 500, 'S5. oldest last');
  eq(snaps[0].kind, 'conflict', 'S6. newest is the conflict snapshot');
  ok(snaps.some((s) => s.kind === 'bak'), 'S7. a .bak snapshot is included');
  ok(snaps.some((s) => s.kind === 'corrupt'), 'S8. a .corrupt snapshot is included');
  ok(snaps.every((s) => s.key !== LS_DOC), 'S9. CARDINAL: the live LS_DOC is never offered as a recovery (no false self-restore)');
}

/* ── dismissal: a dismissed snapshot stops surfacing, others remain ── */
{
  const storage = makeStorage({
    [CONFLICT_PREFIX + '1000-000000']: DOC('one'),
    [CONFLICT_PREFIX + '2000-000000']: DOC('two'),
  });
  const before = scanRecoverySnapshots({ storage });
  eq(before.length, 2, 'D1. two snapshots before any dismissal');
  const target = before[1].key; // the older one
  const persisted = dismissSnapshot(target, { storage });
  ok(persisted === true, 'D2. dismissal persisted to storage');
  const after = scanRecoverySnapshots({ storage });
  eq(after.length, 1, 'D3. dismissed snapshot no longer surfaces');
  ok(after[0].key !== target, 'D4. the remaining one is the non-dismissed snapshot');
  ok(storage.getItem(LS_DISMISSED) != null, 'D5. dismissal bookkeeping written under its own key');
  // and the dismissal bookkeeping key is itself never offered as a recovery
  ok(after.every((s) => s.key !== LS_DISMISSED), 'D6. the dismissal key is not mistaken for a snapshot');
}

/* ── empty / unreadable snapshots are skipped (nothing to recover) ── */
{
  const storage = makeStorage({
    [CONFLICT_PREFIX + '1000-000000']: '',                 // empty -> skip
    [CONFLICT_PREFIX + '2000-000000']: DOC('real'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 1, 'E1. empty snapshot value is skipped');
  eq(snaps[0].ts, 2000, 'E2. the real one survives');
}

/* ── readSnapshot returns the parsed doc; unparseable -> null (never throws) ── */
{
  const storage = makeStorage({
    [CONFLICT_PREFIX + '1000-000000']: DOC('hello'),
    [CONFLICT_PREFIX + '2000-000000']: '{not json',
  });
  const good = readSnapshot(CONFLICT_PREFIX + '1000-000000', { storage });
  ok(good && good.type === 'doc', 'R1. parses a good snapshot');
  const bad = readSnapshot(CONFLICT_PREFIX + '2000-000000', { storage });
  ok(bad === null, 'R2. unparseable snapshot -> null (no throw)');
  ok(readSnapshot('missing-key', { storage }) === null, 'R3. missing key -> null');
}

/* ── snapshotToText: flattens a ProseMirror doc to readable text, preserves the words ── */
{
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', content: [{ type: 'text', text: 'CHAPTER ONE' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The unsynced word lives here.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'And a second line.' }] },
    ],
  };
  const text = snapshotToText(doc);
  ok(text.includes('CHAPTER ONE'), 'X1. heading text recovered');
  ok(text.includes('The unsynced word lives here.'), 'X2. the unsynced word is in the recovered text');
  ok(text.includes('And a second line.'), 'X3. second paragraph recovered');
  ok(/CHAPTER ONE\n\n/.test(text) || text.indexOf('CHAPTER ONE') < text.indexOf('The unsynced'), 'X4. block separation keeps it readable');
  eq(snapshotToText(null), '', 'X5. null doc -> empty string (never throws)');
  // also tolerate a wrapper { doc: {...} } shape
  ok(snapshotToText({ doc }).includes('unsynced word'), 'X6. handles a {doc:{...}} wrapper too');
}

/* ── REDUNDANT-BACKUP FILTER (recovery-banner-spam): a snapshot whose content EQUALS the live saved
      doc is NOT surfaced — it's a backup of already-saved work, nothing to recover. A snapshot with
      genuinely-different content IS surfaced. This is the root fix for "N earlier edits backed up"
      never clearing no matter how often backups are cleared. ── */
{
  const storage = makeStorage({
    [LS_DOC]: DOC('the saved doc on screen'),
    // content-equal to the live doc (redundant backup the adopt path keeps minting) -> filtered
    [CONFLICT_PREFIX + '3000-000000']: DOC('the saved doc on screen'),
    // genuinely-unsynced content -> surfaced
    [CONFLICT_PREFIX + '1000-000000']: DOC('an unsynced word that is NOT in the saved doc'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 1, 'F1. only the genuinely-unsynced snapshot surfaces (content-equal backup filtered)');
  eq(snaps[0].ts, 1000, 'F2. the surfaced one is the unique-content snapshot');
}

/* ── canonical compare: a key-order reflow (cosmetic round-trip) of the SAME content is treated as
      equal-to-live and filtered — not mistaken for a real edit (mirrors cloud-sync localDiffersFrom). ── */
{
  // Same logical doc, different key insertion order — stableStringify sorts keys so they're equal.
  const live = JSON.stringify({ type: 'doc', attrs: { a: 1, b: 2 }, content: [] });
  const reflow = JSON.stringify({ content: [], attrs: { b: 2, a: 1 }, type: 'doc' });
  const storage = makeStorage({
    [LS_DOC]: live,
    [CONFLICT_PREFIX + '2000-000000']: reflow,
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 0, 'F3. cosmetic key-order reflow of live content is filtered (canonical compare)');
}

/* ── content dedup: the same bytes under two keys never show twice ── */
{
  const storage = makeStorage({
    [LS_DOC]: DOC('saved'),
    [CONFLICT_PREFIX + '1000-000000']: DOC('identical unsynced edit'),
    [CONFLICT_PREFIX + '2000-000000']: DOC('identical unsynced edit'),
    [CONFLICT_PREFIX + '3000-000000']: DOC('a different unsynced edit'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 2, 'F4. identical-content snapshots collapse to one; the distinct one survives');
  eq(snaps[0].ts, 3000, 'F5. newest-first ordering preserved across the dedup');
}

/* ── banner-empty case: ALL snapshots are content-equal to the live doc -> empty list (banner clears) ── */
{
  const storage = makeStorage({
    [LS_DOC]: DOC('everything is already saved'),
    [CONFLICT_PREFIX + '1000-000000']: DOC('everything is already saved'),
    [BAK_PREFIX + '2000']: DOC('everything is already saved'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 0, 'F6. all-redundant snapshots -> empty list (the persistent banner finally clears)');
}

/* ── no live doc on disk: nothing to compare against, so snapshots are NOT filtered (err toward surfacing) ── */
{
  const storage = makeStorage({
    [CONFLICT_PREFIX + '1000-000000']: DOC('an edit with no live doc to compare'),
  });
  const snaps = scanRecoverySnapshots({ storage });
  eq(snaps.length, 1, 'F7. with no live LS_DOC, the snapshot still surfaces (cannot prove it redundant)');
}

/* ── async scan applies the same redundant-backup filter (localStorage-only path, IDB unavailable) ── */
{
  const { scanRecoverySnapshotsAsync } = await import('./recovery.js');
  const storage = makeStorage({
    [LS_DOC]: DOC('cloud-synced doc'),
    [CONFLICT_PREFIX + '3000-000000']: DOC('cloud-synced doc'),              // redundant -> filtered
    [CONFLICT_PREFIX + '1000-000000']: DOC('genuinely-unsynced async edit'), // surfaced
  });
  const snaps = await scanRecoverySnapshotsAsync({ storage }); // no indexedDB dep -> IDB skipped
  eq(snaps.length, 1, 'F8. async scan filters the content-equal backup too');
  eq(snaps[0].ts, 1000, 'F9. async scan surfaces the genuinely-unsynced snapshot');
}

/* ── no storage / empty storage -> empty list, never throws ── */
{
  eq(scanRecoverySnapshots({ storage: makeStorage({}) }).length, 0, 'N1. empty storage -> no snapshots');
  eq(scanRecoverySnapshots({ storage: null }).length, 0, 'N2. null storage -> [] (never throws)');
}

console.log(`\nrecovery: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
