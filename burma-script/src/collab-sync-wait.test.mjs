// Locks providerSynced — the collab seed-safety gate (burma-script/src/collab-sync-wait.js).
//
// providerSynced decides whether the room's emptiness is KNOWN (initial sync complete) vs merely
// "not yet downloaded". seedRoomIfEmpty seeds a room ONLY when empty; an undownloaded room also
// reads empty (fragment.length === 0), so mistaking "not synced yet" for "genuinely empty" would
// seed on top of server content → a forked/duplicated doc. The `false` return on timeout is the
// safety line the caller keys on ("must NOT seed on false"). These cases lock that contract, and
// are mutation-proven: neutering the false-on-timeout branch to always-true turns the load-bearing
// case RED.
//
// Run: node burma-script/src/collab-sync-wait.test.mjs   (or via `bun run test`)
import assert from 'node:assert';
import { providerSynced } from './collab-sync-wait.js';

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Minimal fake Liveblocks/Yjs provider: an event bus with a `synced` flag. `fireAfter` schedules a
// 'synced' emit (optionally flipping `synced` first); `flipAt` flips `synced` WITHOUT emitting (the
// "missed event" case the timeout's `!!provider.synced` re-read covers).
function makeProvider({ synced = false, fireAfter = null, flipAt = null, flipTo = true,
                       onThrows = false } = {}) {
  const listeners = {};
  const p = {
    synced,
    on(ev, cb) { if (onThrows) throw new Error('no bus'); (listeners[ev] ||= []).push(cb); },
    off(ev, cb) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb); },
    offCalls: 0,
    _emit(ev) { (listeners[ev] || []).slice().forEach((f) => f()); },
    _listenerCount(ev) { return (listeners[ev] || []).length; },
  };
  const realOff = p.off;
  p.off = (ev, cb) => { p.offCalls++; return realOff(ev, cb); };
  if (fireAfter != null) setTimeout(() => { if (flipTo != null) p.synced = flipTo; p._emit('synced'); }, fireAfter);
  if (flipAt != null) setTimeout(() => { p.synced = flipTo; }, flipAt);
  return p;
}

// 1. Already synced → resolves true immediately, never subscribes a listener.
await ok('already synced resolves true without subscribing', async () => {
  const p = makeProvider({ synced: true });
  const r = await providerSynced(p, 1000);
  assert.strictEqual(r, true);
  assert.strictEqual(p._listenerCount('synced'), 0, 'should not subscribe when already synced');
});

// 2. 'synced' event fires before the timeout → resolves true, and the listener is cleaned up.
await ok("'synced' event before timeout resolves true and cleans up", async () => {
  const p = makeProvider({ synced: false, fireAfter: 10 });
  const r = await providerSynced(p, 500);
  assert.strictEqual(r, true);
  assert.strictEqual(p.offCalls, 1, 'cleanup must off() the listener exactly once');
  assert.strictEqual(p._listenerCount('synced'), 0, 'listener must be removed after resolve');
});

// 3. THE SAFETY LINE — never syncs, timeout fires while still unsynced → resolves FALSE.
//    (Mutation target: changing the timeout branch to resolve(true) breaks THIS.)
await ok('timeout while unsynced resolves FALSE (caller must not seed)', async () => {
  const p = makeProvider({ synced: false });
  const r = await providerSynced(p, 30);
  assert.strictEqual(r, false, 'an undownloaded room must NOT be treated as synced');
});

// 4. Missed-event recovery — synced flips true (no emit) before the timeout; the timeout's
//    `!!provider.synced` re-read must catch it and resolve TRUE, not spuriously FALSE.
await ok('timeout re-reads provider.synced (missed event) → true', async () => {
  const p = makeProvider({ synced: false, flipAt: 10 });
  const r = await providerSynced(p, 40);
  assert.strictEqual(r, true, 'a room synced-without-event must resolve true at timeout');
});

// 5. Settles exactly once — a late 'synced' emit AFTER a timeout-false must not flip the result
//    or throw. We resolve on the timeout (false), then fire a late event and confirm stability.
await ok('settles once — late event after timeout does not re-resolve', async () => {
  const p = makeProvider({ synced: false, fireAfter: 40 }); // event lands AFTER the 20ms timeout
  const r = await providerSynced(p, 20);
  assert.strictEqual(r, false, 'timeout wins; the promise already settled false');
  await new Promise((res) => setTimeout(res, 40)); // let the late emit fire — must not throw/hang
  assert.ok(true);
});

// 6. Subscribe throws (no usable event bus) → degrades to resolving true (don't hang the editor).
await ok('provider.on throwing degrades to true (no hang)', async () => {
  const p = makeProvider({ synced: false, onThrows: true });
  const r = await providerSynced(p, 500);
  assert.strictEqual(r, true, 'unsubscribable provider resolves true via the done() fallback');
});

console.log(`collab-sync-wait: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
