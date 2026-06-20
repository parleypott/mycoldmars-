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

console.log(`save-pill-actionable: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
