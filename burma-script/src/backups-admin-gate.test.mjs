/*
 * backups-admin-gate.test.mjs — the ?backups gate on the recovery chrome (main.jsx
 * showAdminBackups → RecoveryBanner + CloudHistoryPanel mount sites).
 *
 * HOTFIX 8111c8d moved the recovery banner and the cloud-history pill OUT of the everyday
 * editor: they now mount ONLY when the URL carries ?backups (search or hash-query, the same
 * parsing posture as read-mode's ?read). That gate is the ONLY doorway left to local-snapshot
 * recovery and cloud version history — if the regex rots or a refactor drops the gate call
 * from one of the two mount sites, either the recovery tools become unreachable (a data-
 * recovery outage nobody notices until a bad day) or the clutter Johnny asked to remove
 * comes back. Nothing locked any of it.
 *
 * main.jsx can't be imported headlessly (CSS imports, Preact mount side-effects), so this
 * suite uses the episode-flag-contract.test.mjs posture: statically scan the LIVE source,
 * then EXECUTE the extracted shipped function (new Function — the actual bytes, not a
 * re-implementation) against stubbed window.location shapes.
 *
 * Proves:
 *   1. GATE PRESENT — both mount sites read `!readOnly && showAdminBackups() &&` (recovery
 *      chrome is never mounted bare, and never in read-only).
 *   2. URL CONTRACT — the shipped showAdminBackups() accepts ?backups in the search string
 *      AND after a ? inside the hash (#slug?backups — the library-entry shape), including
 *      alongside other params; rejects plain URLs, ?read, and prefix look-alikes
 *      (?backupsfoo); and fails CLOSED (false) when location access throws.
 *
 * Run: bun src/backups-admin-gate.test.mjs  (auto-discovered by scripts/run-tests.mjs)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, 'main.jsx'), 'utf8');

let pass = 0;
const ok = (label, fn) => { fn(); pass++; };

// ── 1: both recovery-chrome mount sites carry the full gate ────────────────────────────────
ok('RecoveryBanner and CloudHistoryPanel mount ONLY behind !readOnly && showAdminBackups()', () => {
  for (const comp of ['RecoveryBanner', 'CloudHistoryPanel']) {
    // restore-collab: the mounts now carry props (getEditor={...}), so match `<Comp ... />` —
    // the capture group is still ONLY the gate expression between `{` and the component tag.
    const mounts = [...src.matchAll(new RegExp(`\\{([^{}]*)<${comp}\\b[\\s\\S]*?/>`, 'g'))];
    assert.ok(mounts.length >= 1, `<${comp} /> is mounted somewhere`);
    for (const m of mounts) {
      assert.ok(/!readOnly\s*&&/.test(m[1]), `<${comp} /> gated off read-only`);
      assert.ok(/showAdminBackups\(\)\s*&&/.test(m[1]), `<${comp} /> gated behind showAdminBackups()`);
    }
  }
});

// ── 2: run the SHIPPED function bytes against URL shapes ───────────────────────────────────
const fnMatch = src.match(/function showAdminBackups\(\) \{[\s\S]*?\n\}/);
ok('showAdminBackups() exists in main.jsx (extractable)', () => {
  assert.ok(fnMatch, 'function showAdminBackups() { … } found in main.jsx');
});

const runGate = (location) => {
  const fn = new Function('window', `${fnMatch[0]}\nreturn showAdminBackups();`);
  return fn({ location });
};

ok('?backups in the search string opens the admin chrome', () => {
  assert.equal(runGate({ search: '?backups', hash: '' }), true);
  assert.equal(runGate({ search: '?foo=1&backups', hash: '' }), true);
});

ok('#slug?backups (the library BACKUPS-entry shape) opens it too', () => {
  assert.equal(runGate({ search: '', hash: '#burma?backups' }), true);
  assert.equal(runGate({ search: '', hash: '#my-project?x=1&backups' }), true);
});

ok('everyday URLs stay calm — no recovery chrome', () => {
  assert.equal(runGate({ search: '', hash: '' }), false);
  assert.equal(runGate({ search: '', hash: '#burma' }), false);
  assert.equal(runGate({ search: '?read', hash: '' }), false, '?read is the SHARE flag, not admin');
});

ok('prefix look-alikes do not leak the chrome in', () => {
  assert.equal(runGate({ search: '?backupsfoo', hash: '' }), false);
  assert.equal(runGate({ search: '', hash: '#slug?backupsx' }), false);
});

ok('fails CLOSED when location access throws', () => {
  const fn = new Function('window', `${fnMatch[0]}\nreturn showAdminBackups();`);
  const boobyTrapped = {};
  Object.defineProperty(boobyTrapped, 'location', { get() { throw new Error('nope'); } });
  assert.equal(fn(boobyTrapped), false);
});

console.log(`backups-admin-gate.test.mjs: ${pass} assertions passed`);
