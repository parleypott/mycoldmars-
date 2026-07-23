/**
 * CLOUD DURABILITY SIGNAL — the DOM-WIRING SEAM (installCloudHealthListeners, src/cloud-health.js).
 *
 * cloud-health.test.mjs pins the pure verdict + the sole-durability one-shot by driving
 * noteCloudOutcome directly. This file locks the OTHER half: the browserless-testable listener
 * installer main.jsx calls at boot (setCloudBackedPredicate + installCloudHealthListeners, main.jsx
 * ~2120), which is the ONLY bridge between the real wp-cloud-* events cloud-sync.js fires and the
 * escalation one-shot. Its three load-bearing contracts had ZERO coverage:
 *
 *   1. IDEMPOTENT — main.jsx can call it more than once (re-init); it must wire each event ONCE, never
 *      stack duplicate handlers that would double-fire every cloud outcome.
 *   2. ALL FIVE EVENTS ROUTE CORRECTLY — especially wp-cloud-conflict-own → 'conflict', because a
 *      SAME-USER 409 is a push that did NOT merge THIS edit. If a sole-durability save (localStorage
 *      fully dead, riding only the cloud) hits a conflict-own and the wiring DROPPED it, the loud
 *      banner would never re-raise — a silent under-alarm, the cardinal sin this whole module exists
 *      to prevent.
 *   3. NEVER THROWS — a null/degenerate win (headless, old build) is a silent no-op, not a boot crash.
 *
 * Pure module — no real browser. We inject a fake `win` that records + dispatches handlers.
 *
 * Run: bun src/cloud-health-listeners.test.mjs   (auto-discovered by run-tests.mjs)
 */

const {
  installCloudHealthListeners, noteCloudOutcome, getCloudOutcome,
  armCloudSoleDurability, resetCloudHealth,
} = await import('./cloud-health.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };

// A fake window: records addEventListener handlers per type, dispatches them with no payload
// (the real handlers ignore the event arg — they just call noteCloudOutcome).
function makeWin() {
  const handlers = {};
  return {
    handlers,
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    dispatch(type) { (handlers[type] || []).forEach((fn) => fn()); },
    count(type) { return (handlers[type] || []).length; },
  };
}

const EVENTS = [
  'wp-cloud-saving', 'wp-cloud-saved', 'wp-cloud-offline',
  'wp-cloud-conflict', 'wp-cloud-conflict-own',
];

// ── NEVER THROWS on a degenerate win (runs FIRST: a bad win early-returns BEFORE the install latch,
//    so it can't poison the idempotency test below). ──────────────────────────────────────────────
{
  let threw = false;
  try { installCloudHealthListeners(null); } catch { threw = true; }
  ok(threw === false, 'A1. null win → silent no-op, never throws');

  threw = false;
  try { installCloudHealthListeners({}); } catch { threw = true; } // no addEventListener
  ok(threw === false, 'A2. win without addEventListener → silent no-op, never throws');
}

// ── FIRST REAL INSTALL: every cloud event wired exactly once ──────────────────────────────────────
const win = makeWin();
{
  installCloudHealthListeners(win);
  ok(EVENTS.every((t) => win.count(t) === 1),
    'B1. first install wires all five wp-cloud-* events exactly once');
  ok(win.count('wp-cloud-conflict-own') === 1,
    'B2. the SAME-USER conflict event is wired (the under-alarm guard depends on it)');
}

// ── IDEMPOTENT: a second install must NOT stack duplicate handlers ────────────────────────────────
{
  const win2 = makeWin();
  installCloudHealthListeners(win2); // module already installed → this is a no-op
  ok(EVENTS.every((t) => win2.count(t) === 0),
    'C1. second install on a fresh win wires NOTHING (idempotent — no double-fire)');
  // And the original win still holds exactly one handler per type (not re-stacked either).
  ok(EVENTS.every((t) => win.count(t) === 1), 'C2. original win handlers not duplicated');
}

// ── EVENT ROUTING: each dispatched event lands the right outcome ───────────────────────────────────
{
  resetCloudHealth();
  win.dispatch('wp-cloud-saving');
  ok(getCloudOutcome().outcome === 'syncing', 'D1. wp-cloud-saving → syncing');

  win.dispatch('wp-cloud-saved');
  ok(getCloudOutcome().outcome === 'saved', 'D2. wp-cloud-saved → saved');

  win.dispatch('wp-cloud-offline');
  ok(getCloudOutcome().outcome === 'offline', 'D3. wp-cloud-offline → offline');

  win.dispatch('wp-cloud-conflict');
  ok(getCloudOutcome().outcome === 'conflict', 'D4. wp-cloud-conflict → conflict');

  win.dispatch('wp-cloud-conflict-own');
  ok(getCloudOutcome().outcome === 'conflict', 'D5. wp-cloud-conflict-own → conflict (same-user 409 counts)');
}

// ── THE LOAD-BEARING UNDER-ALARM GUARD ────────────────────────────────────────────────────────────
// A sole-durability save (localStorage dead, riding only the cloud) that hits a SAME-USER conflict
// must re-raise the loud banner — the cloud did NOT take this edit. If the conflict-own listener were
// dropped, onLost would never fire and Johnny would lose the edit silently.
{
  resetCloudHealth();
  let lost = 0;
  armCloudSoleDurability(() => { lost++; });
  win.dispatch('wp-cloud-conflict-own');
  ok(lost === 1, 'E1. armed sole-durability + wp-cloud-conflict-own → onLost fires (re-raise the banner)');
}
// The calm case: a confirmed save through the wire disarms the one-shot — no false alarm.
{
  resetCloudHealth();
  let lost = 0;
  armCloudSoleDurability(() => { lost++; });
  win.dispatch('wp-cloud-saved');
  ok(lost === 0, 'E2. armed sole-durability + wp-cloud-saved → onLost does NOT fire (durable, stay calm)');
}

console.log(`\ncloud-health-listeners: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
