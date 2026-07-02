/**
 * Tests for episode-config's NOTIFY listener-isolation contract — the episode-switch
 * broadcast in burma-script/src/episode-config.js.
 *
 * Why this is load-bearing:
 *
 *   Seven modules register an episode-change listener via onEpisodeChange (recovery,
 *   migrate-doc, cloud-sync, Editor.jsx, Workshop.jsx, write-token, recovery-store). Each
 *   listener's job is to recompute THAT module's live localStorage keys for the newly
 *   active episode (syncStorageKeys / syncEpisodeKeys). setEpisode(...) fires notify(),
 *   which broadcasts to all of them.
 *
 *   The hazard the fix closes: a BARE `for (const l of listeners) l(ep)` loop lets ONE
 *   listener that throws strand every listener registered AFTER it — those modules never
 *   recompute their keys, so they keep reading/writing the PREVIOUS episode's document
 *   (Burma content landing under Palau's key, or vice-versa). That's silent cross-episode
 *   data corruption in a tool Johnny actively uses.
 *
 *   The fix isolates each listener in try/catch (mirroring translation/src/auth.js's
 *   notifier) so a throwing module poisons only itself; the rest still resync.
 *
 * Mutation proof: revert notify() to the bare loop and the "later listeners still fire
 * after an earlier one throws" assertions go RED (the throw aborts the loop).
 *
 * Run: bun src/episode-config-notify.test.mjs
 */
import { setEpisode, onEpisodeChange, getEpisode } from './episode-config.js';
import { BURMA } from '../config.js';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`✗ ${msg}\n    expected ${e}\n    got      ${a}`); }
}

// Silence the intentional console.warn the isolation emits so test output stays clean,
// while still recording that a warning WAS produced for the throwing listener.
const realWarn = console.warn;
let warnCount = 0;
console.warn = (...args) => {
  if (String(args[0] || '').includes('[episode-config]')) { warnCount++; return; }
  realWarn(...args);
};

// ─────────────── a throwing listener must not strand the ones after it ───────────────
{
  const order = [];
  // onEpisodeChange fires the listener immediately on registration too, so guard the
  // immediate call — we only care about the notify() broadcast triggered by setEpisode.
  let live = false;
  const thrower = () => { if (live) { order.push('thrower'); throw new Error('boom'); } };
  const after = () => { if (live) order.push('after'); };

  const offThrower = onEpisodeChange(thrower); // registers (immediate call: live=false, no-op)
  const offAfter = onEpisodeChange(after);

  live = true;
  warnCount = 0;
  // switch the active episode → notify() broadcasts to both, in registration order
  setEpisode(BURMA);

  ok(order.includes('thrower'), 'the throwing listener was invoked');
  ok(order.includes('after'), 'a listener registered AFTER the thrower STILL fired (isolation)');
  eq(order, ['thrower', 'after'], 'both listeners ran in registration order despite the throw');
  ok(warnCount === 1, 'exactly one isolation warning was logged for the throwing listener');

  offThrower();
  offAfter();
}

// ─────────────── setEpisode returns cleanly even when a listener throws ───────────────
{
  let live = false;
  const thrower = () => { if (live) throw new Error('boom2'); };
  const off = onEpisodeChange(thrower);
  live = true;
  let returned, threw = false;
  try { returned = setEpisode(BURMA); } catch { threw = true; }
  ok(!threw, 'setEpisode did not propagate the listener throw to its caller');
  eq(returned, BURMA, 'setEpisode returned the active episode');
  ok(getEpisode() === BURMA, 'active episode is correctly set after the switch');
  off();
}

// ─────────────── the happy path is unchanged: all listeners fire, no warnings ───────────────
{
  const seen = [];
  let live = false;
  const a = (ep) => { if (live) seen.push(['a', ep === BURMA]); };
  const b = (ep) => { if (live) seen.push(['b', ep === BURMA]); };
  const offA = onEpisodeChange(a);
  const offB = onEpisodeChange(b);
  live = true;
  warnCount = 0;
  setEpisode(BURMA);
  eq(seen, [['a', true], ['b', true]], 'all listeners fire with the active episode on a clean switch');
  ok(warnCount === 0, 'no isolation warning on the happy path');
  offA();
  offB();
}

// ─────────────── the INITIAL invocation is isolated too (bootstrap resilience) ───────────────
// onEpisodeChange fires the listener ONCE on registration. Seven modules do this at module-load
// (top-level). A listener that throws on that first call must NOT propagate out of onEpisodeChange
// — otherwise it aborts the registrant's module evaluation and can white-screen the whole editor.
// Mutation proof: revert line 51 to a bare `listener(activeEpisode)` and the first two assertions
// here go RED (the throw escapes onEpisodeChange).
{
  warnCount = 0;
  let off, threw = false;
  const boomOnRegister = () => { throw new Error('boom-on-register'); };
  try { off = onEpisodeChange(boomOnRegister); } catch { threw = true; }

  ok(!threw, 'onEpisodeChange did not propagate a throw from the immediate (registration) call');
  ok(typeof off === 'function', 'the registrant STILL received a working unsubscribe handle');
  ok(warnCount === 1, 'exactly one isolation warning was logged for the throwing initial call');

  // The throwing listener is still registered, so a later switch broadcasts to it — and notify()'s
  // own isolation must keep a sibling firing despite it. This proves registration completed.
  const sawSibling = [];
  const offSibling = onEpisodeChange(() => {}); // immediate call: no-op, harmless
  let live2 = false;
  const sibling = () => { if (live2) sawSibling.push(true); };
  const offSibling2 = onEpisodeChange(sibling);
  live2 = true;
  warnCount = 0;
  setEpisode(BURMA); // broadcasts to boomOnRegister (throws→isolated) + sibling
  ok(sawSibling.length === 1, 'a later switch still reaches a healthy sibling despite the registered thrower');
  ok(warnCount === 1, 'the registered thrower re-threw on the switch and was isolated (one warning)');

  if (typeof off === 'function') off();
  offSibling(); offSibling2();
}

console.warn = realWarn;

if (fail) {
  console.error(`episode-config-notify: ${pass} passed, ${fail} failed`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
} else {
  console.log(`episode-config-notify: ${pass} passed, 0 failed`);
}
