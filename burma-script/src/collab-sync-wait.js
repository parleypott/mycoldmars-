// Burma Script Tool — COLLAB SYNC WAIT (seed-safety gate, extracted from collab-runtime.js).
//
// This is the ONE load-bearing decision in the collab seed path that has zero heavy deps, so it
// lives here where it can be unit-tested in isolation (collab-runtime.js itself pulls in
// yjs/liveblocks/tiptap and can't be imported in a plain node test). Extracting it is additive:
// collab-runtime.js imports providerSynced from here and its behavior is byte-identical.
//
// WHY IT MATTERS: seedRoomIfEmpty() seeds a room from the cloud doc ONLY when the room is empty.
// But an UNDOWNLOADED room also looks empty (fragment.length === 0) until the provider finishes its
// initial sync. If we mistook "not yet downloaded" for "genuinely empty", we'd seed on top of a
// room that already has content on the server → a forked/duplicated doc, the exact data-corruption
// this gate prevents. providerSynced resolves `true` ONLY when sync is actually known-complete, and
// `false` on timeout — and the caller MUST NOT seed on false. That false return is the safety line.

// Resolve when the provider has completed its initial sync with the Liveblocks room (so the
// fragment's emptiness is KNOWN, not just "not yet downloaded"). Resolves `true` on sync,
// `false` on timeout — the caller must NOT seed on false (an undownloaded room isn't empty).
// If the provider is ALREADY synced, resolves `true` immediately without waiting. If the 'synced'
// event never arrives before the timeout, re-reads provider.synced one last time (covers a missed
// event) and resolves that boolean. Settles exactly once. If subscribing throws (no usable event
// bus), degrades to resolving `true` so a provider that can't emit doesn't hang the editor.
export function providerSynced(provider, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (provider.synced) return resolve(true);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(!!provider.synced);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      try { provider.off('synced', done); } catch {}
    }
    try { provider.on('synced', done); } catch { done(); }
  });
}
