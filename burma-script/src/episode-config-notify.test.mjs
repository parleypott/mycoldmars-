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

console.warn = realWarn;

if (fail) {
  console.error(`episode-config-notify: ${pass} passed, ${fail} failed`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
} else {
  console.log(`episode-config-notify: ${pass} passed, 0 failed`);
}
