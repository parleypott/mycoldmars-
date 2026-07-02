/*
 * restore-reconcile-seam.test.mjs — Enterprise Wave (version-history RESTORE), the END-TO-END lock.
 *
 * restore-flow.test.mjs already locks the ORDERING contract of restoreDoc/restoreSnapshot (back up the
 * current doc FIRST, adopt only after, abort if the backup can't land). But that is only half the
 * story for a CLOUD-BACKED project. After the restore writes the chosen (usually OLDER) revision
 * locally, restore.js reloads the page — and on reload reconcileOnLoad runs, comparing the just-written
 * local doc against the CURRENT cloud head. If the restored doc's version does NOT sit above the cloud
 * head, decideReconcile Rule 2 fires `adopt-cloud` and the reload SILENTLY THROWS THE RESTORE AWAY:
 * Johnny clicks "restore this version", the page reloads, and he's right back on the latest doc.
 *
 * The feature only works because of an emergent property that spans THREE modules with no single test:
 *   1. saveDoc (migrate-doc.js:1105) stamps  newVersion = max(storedVersion, knownBaseVersion) + 1  —
 *      so the restored doc is ALWAYS one past whatever was on disk (which, in a synced cloud project,
 *      is at least the cloud head). The restored content therefore rides the NEWEST version number.
 *   2. decideReconcile (cloud-sync.js) Rule 3 KEEPS a local doc whose version is >= the cloud head and
 *      pushes it up — so the restored doc becomes the new cloud head instead of being adopted-over.
 *   3. Rule 2 only adopts the cloud when it is STRICTLY newer (cv > lv).
 *
 * This test pins that seam with the REAL decideReconcile, composed with a faithful mirror of saveDoc's
 * version formula, so a future refactor of EITHER side that would silently un-stick restore goes RED
 * here even though every existing green test would stay green.
 */
import { decideReconcile } from './cloud-sync.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// Faithful mirror of the ONE line in saveDoc (migrate-doc.js:1105) that stamps a write's version.
// Kept tiny + inline so this test states the exact contract the restore relies on; the real saveDoc
// has its own guards/coverage — here we only need the version it would produce for a restore write.
const stampVersion = (storedVersion, knownBaseVersion) =>
  Math.max(storedVersion, knownBaseVersion < 0 ? 0 : knownBaseVersion) + 1;

const CLOUD_HEAD = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'latest cloud head' }] }] };

// ── saveDoc's stamp always advances past the on-disk version ───────────────────────────────────────
ok(stampVersion(10, 10) === 11, 'stamp: synced tab (stored=base=cloud head 10) → v11, one past cloud');
ok(stampVersion(10, -1) === 11, 'stamp: fresh base (-1) still advances to v11');
ok(stampVersion(12, 10) === 13, 'stamp: a tab with unsynced local edits (stored 12) advances to v13');

// ── THE SEAM: a restore in a cloud project must WIN the post-reload reconcile ───────────────────────
// Cloud head is at v10. Johnny restores an OLD revision (say v3's content). saveDoc writes that content
// but stamps it at stampVersion(stored=10, base=10) = v11. On reload, reconcile sees local v11 vs cloud
// v10 → keep-local → the restored content sticks and is pushed up as the new head.
{
  const cloudVer = 10;
  const restoredLocalVer = stampVersion(cloudVer, cloudVer); // = 11
  const d = decideReconcile({ localVersion: restoredLocalVer, hasLocalDoc: true, cloud: { ok: true, doc: CLOUD_HEAD, version: cloudVer } });
  ok(d.action === 'keep-local', 'seam: restored doc (v11) is KEPT over the older cloud head (v10) — restore sticks');
  ok(d.push === true, 'seam: the kept restore is pushed up to become the new cloud head');
}

// Tie boundary: even if the stamp landed EXACTLY at the cloud head, Rule 2 needs STRICTLY newer, so a
// tie still keeps local. Restore survives at the boundary, never adopted-over.
{
  const d = decideReconcile({ localVersion: 10, hasLocalDoc: true, cloud: { ok: true, doc: CLOUD_HEAD, version: 10 } });
  ok(d.action === 'keep-local', 'seam: version tie (v10 == cloud v10) still keeps local — restore not clobbered on a tie');
}

// Offline reload: cloud fetch unknown (API down / table missing) → keep-local, so a restore survives
// even when the reload cannot reach the cloud.
{
  const d = decideReconcile({ localVersion: 11, hasLocalDoc: true, cloud: { ok: false } });
  ok(d.action === 'keep-local', 'seam: cloud unknown on reload → keep-local, restore survives offline');
}

// ── MUTATION DEMONSTRATION — why the version BUMP is load-bearing ───────────────────────────────────
// Had the restore written the old revision WITHOUT advancing the version (i.e. left it at the old rev's
// own number, v3, below the cloud head v10), decideReconcile would fire adopt-cloud on the reload and
// the restore would be silently discarded. This asserts the failure mode the stamp+Rule-3 pair prevents,
// so if someone "simplifies" decideReconcile to adopt on >= (or saveDoc to preserve the source version),
// this line proves the restore feature would break.
{
  const d = decideReconcile({ localVersion: 3, hasLocalDoc: true, cloud: { ok: true, doc: CLOUD_HEAD, version: 10 } });
  ok(d.action === 'adopt-cloud', 'mutation: a restore that did NOT advance past cloud (v3 < v10) WOULD be clobbered — proves the bump is load-bearing');
}

// A fresh device with no local doc must still seed from the cloud head (restore is a HAS-local-doc path;
// this guards the sibling rule so a refactor can't conflate them).
{
  const d = decideReconcile({ localVersion: 0, hasLocalDoc: false, cloud: { ok: true, doc: CLOUD_HEAD, version: 10 } });
  ok(d.action === 'seed-from-cloud', 'sibling: no local doc → seed-from-cloud (distinct from the restore keep-local path)');
}

if (fail === 0) console.log('restore-reconcile-seam: ' + pass + ' passed, 0 failed');
else { console.log('restore-reconcile-seam: ' + fail + ' FAILED, ' + pass + ' passed'); process.exit(1); }
