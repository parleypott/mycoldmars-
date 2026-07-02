/*
 * save-pill-actionable.test.mjs — ux-06 guard.
 *
 * The save pill was position:fixed bottom-right with pointer-events:none, so in the FAILED state it
 * read "SAVE FAILED — EXPORT NOW" but offered NO action, and it sat underneath the right-edge workshop
 * dock when open — the one indicator that must never be hidden or inert was both. This locks the fix:
 *   • the failed pill carries a real EXPORT button that fires wp-open-exports,
 *   • .is-failed re-enables pointer-events,
 *   • while body[data-workshop-open] is set, the failed pill moves off the right edge.
 * Source/CSS assertions (no browser).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, 'main.jsx'), 'utf8');
const css = readFileSync(join(here, 'styles.css'), 'utf8');
const ws = readFileSync(join(here, 'Workshop.jsx'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('  ✗', name); } }

// The failed pill has a real action button wired to the same event the footer EXPORT fires.
ok('failed pill renders an action button', /wp-save-pill-act/.test(main));
ok('action button dispatches wp-open-exports', /wp-save-pill-act[\s\S]{0,200}wp-open-exports/.test(main));

// CSS: base pill is inert, but the failed pill (and its button) re-enable pointer events.
const base = css.match(/\.wp-save-pill\s*\{[^}]*\}/);
ok('base pill is pointer-events:none', !!base && /pointer-events:\s*none/.test(base[0]));
ok('failed pill re-enables pointer events', /\.wp-save-pill\.is-failed[^}]*pointer-events:\s*auto/.test(css));
ok('action button is clickable', /\.wp-save-pill-act[^}]*pointer-events:\s*auto/.test(css));

// Overlap avoidance: while the dock is open, the failed pill leaves the right edge.
ok('failed pill dodges dock when workshop open', /body\[data-workshop-open\]\s+\.wp-save-pill\.is-failed[^}]*(right:\s*auto|left:)/.test(css));
ok('Workshop flags body when dock open', /data-workshop-open/.test(ws));

// ── Enterprise Wave 1 #3 — HONEST SAVE PILL: a "SYNCING TO CLOUD…" pending state ──────────────────
// The pill could read "SAVED TO CLOUD" while a cloud PUT was still in flight (or had failed). It now
// shows an amber "SYNCING TO CLOUD…" from wp-cloud-saving until the confirmed wp-cloud-saved flips it
// green. This checks the wiring end to end: the event is emitted, listened for, labeled, and styled.
const cloudSync = readFileSync(join(here, 'cloud-sync.js'), 'utf8');

// 1) cloud-sync emits wp-cloud-saving right before the PUT (before the fetch that returns wp-cloud-saved).
ok('cloud-sync defines the wp-cloud-saving event', /wp-cloud-saving/.test(cloudSync));
{
  // The pending event must fire before the PUT that (on success) fires wp-cloud-saved. Compare
  // against the PUT method literal — not `fetchImpl(API`, which also appears earlier in fetchCloud().
  const savingAt = cloudSync.indexOf('emit(EVT_CLOUD_SAVING');
  const putAt = cloudSync.indexOf("method: 'PUT'");
  ok('pending event is emitted BEFORE the fetch PUT', savingAt > 0 && putAt > 0 && savingAt < putAt);
}

// 2) SaveStatus listens for it and maps it to a distinct amber "syncing" cloud state, not green.
ok('main listens for wp-cloud-saving', /addEventListener\('wp-cloud-saving'/.test(main));
ok('pending never overrides a sticky conflict', /onCloudSaving = \(\) => setCloud\(\(c\) => \(c === 'conflict' \? c : 'syncing'\)\)/.test(main));
ok('pending state has its own honest label', /cloud === 'syncing'[\s\S]{0,60}SYNCING TO CLOUD/.test(main));
// green "SAVED TO CLOUD" is only reachable via the confirmed cloud state, never the syncing one.
ok("green label still gated on cloud === 'cloud'", /cloud === 'cloud'[\s\S]{0,40}SAVED TO CLOUD/.test(main));
// 3) the pill carries the is-cloud-syncing class only in the saved+syncing state, and CSS styles it.
ok('pill gets is-cloud-syncing class', /is-cloud-syncing/.test(main));
ok('CSS styles the syncing pill (amber pulse)', /\.wp-save-pill\.is-cloud-syncing/.test(css));

console.log(`save-pill-actionable: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
