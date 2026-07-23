/**
 * CLOUD DURABILITY SIGNAL (honest-banner) — src/cloud-health.js.
 *
 * The Nile false alarm: localStorage filled on the shared newpress.press origin (or Safari blocked
 * it), the local mirror write failed, and the save banner screamed "your edits will NOT be saved" —
 * while the cloud copy was saving fine. This module is the signal the banners consult so they only
 * scream when durability is GENUINELY gone. These tests pin the POSITIVE-PROOF / FAIL-TOWARD-THE-ALARM
 * posture and the sole-durability escalation one-shot.
 *
 * Pure module — no browser, no network. We drive cloud outcomes via noteCloudOutcome directly.
 *
 * Run: bun src/cloud-health.test.mjs   (auto-discovered by run-tests.mjs)
 */

const {
  setCloudBackedPredicate, isCloudBackedProject, cloudDurabilityHealthy,
  noteCloudOutcome, getCloudOutcome, cloudRecentlySaved,
  armCloudSoleDurability, resetCloudHealth,
} = await import('./cloud-health.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// ── DEFAULT POSTURE: fail toward the alarm ───────────────────────────────────────────────────────
{
  resetCloudHealth();
  setCloudBackedPredicate(null); // un-wired / bad input → default false
  ok(isCloudBackedProject() === false, '1a. un-wired predicate → NOT cloud-backed (loud banner stands)');
  ok(cloudDurabilityHealthy() === false, '1b. un-wired → durability NOT healthy (never suppress on doubt)');
}

// A throwing predicate must never leak; it fails toward the alarm.
{
  setCloudBackedPredicate(() => { throw new Error('boom'); });
  ok(isCloudBackedProject() === false, '1c. throwing predicate → false (fail safe, no leak)');
}

// ── CLOUD-BACKED PROJECT: durability healthy on positive proof ────────────────────────────────────
{
  resetCloudHealth();
  setCloudBackedPredicate(() => true);
  ok(isCloudBackedProject() === true, '2a. cloud-backed predicate honored');
  ok(cloudDurabilityHealthy() === true,
    '2b. cloud-backed → durability healthy even before a push confirms (the push IS the durability)');
}

// Local-only project (Palau) → never healthy: local really is the only home.
{
  setCloudBackedPredicate(() => false);
  ok(cloudDurabilityHealthy() === false, '2c. local-only project → durability NOT healthy → loud banner');
}

// ── OUTCOME TRACKING ─────────────────────────────────────────────────────────────────────────────
{
  resetCloudHealth();
  ok(getCloudOutcome().outcome === 'none', '3a. fresh state → outcome none');
  noteCloudOutcome('syncing');
  ok(getCloudOutcome().outcome === 'syncing', '3b. syncing recorded (in flight)');
  const t = 1_000_000;
  noteCloudOutcome('saved', t);
  ok(getCloudOutcome().outcome === 'saved' && getCloudOutcome().lastSavedAt === t, '3c. saved recorded with timestamp');
  ok(cloudRecentlySaved(60_000, t + 5_000) === true, '3d. cloudRecentlySaved true within window');
  ok(cloudRecentlySaved(60_000, t + 120_000) === false, '3e. cloudRecentlySaved false past window');
}

// ── SOLE-DURABILITY ESCALATION ONE-SHOT ──────────────────────────────────────────────────────────
// saveDoc arms this when a cloud-backed edit landed in NO local store and rides the cloud push.
// A confirmed cloud save DISARMS it (stay calm). An offline/conflict FIRES it (re-raise loud banner).
{
  resetCloudHealth();
  let lost = 0;
  armCloudSoleDurability(() => { lost++; });
  noteCloudOutcome('saved'); // the push landed — durability intact
  ok(lost === 0, '4a. armed → a confirmed cloud save does NOT trigger onLost (calm)');
  // A later failure must NOT retro-fire the already-disarmed one-shot.
  noteCloudOutcome('offline');
  ok(lost === 0, '4b. disarmed one-shot never fires on a later unrelated failure');
}
{
  resetCloudHealth();
  let lost = 0;
  armCloudSoleDurability(() => { lost++; });
  noteCloudOutcome('offline'); // the push we leaned on failed — NOW nothing holds the edit
  ok(lost === 1, '4c. armed → a cloud OFFLINE triggers onLost exactly once (re-raise the loud banner)');
  noteCloudOutcome('offline'); // one-shot: must not fire twice
  ok(lost === 1, '4d. one-shot fires at most once');
}
{
  resetCloudHealth();
  let lost = 0;
  armCloudSoleDurability(() => { lost++; });
  noteCloudOutcome('conflict'); // a 409 that did NOT merge this edit is also a failed landing
  ok(lost === 1, '4e. armed → a cloud CONFLICT triggers onLost (edit not merged = at risk)');
}
{
  resetCloudHealth();
  let a = 0, b = 0;
  armCloudSoleDurability(() => { a++; });
  armCloudSoleDurability(() => { b++; }); // newer save supersedes the older pending one
  noteCloudOutcome('offline');
  ok(a === 0 && b === 1, '4f. latest arm wins — a newer save supersedes the older pending one-shot');
}
// A throwing onLost must never propagate out of the event path.
{
  resetCloudHealth();
  armCloudSoleDurability(() => { throw new Error('boom'); });
  let threw = false;
  try { noteCloudOutcome('offline'); } catch { threw = true; }
  ok(threw === false, '4g. a throwing onLost is swallowed — never breaks the cloud event path');
}

console.log(`\ncloud-health: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
