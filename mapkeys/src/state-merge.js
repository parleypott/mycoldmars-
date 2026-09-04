// MapKeys — conflict merge for project state (pure, headless-testable).
//
// The cloud store is one jsonb blob per project. Until 2026-09-04 saves were
// blind last-write-wins, which let a stale open tab silently DELETE anything
// added from elsewhere (another tab, another machine, an assistant session) —
// it happened three times across tools; this is the invariant that ends it.
//
// mergeProjectStates(local, cloud) resolves a rejected save: the local tab is
// the active editor so it wins every row it knows about; rows that exist only
// in the cloud (added elsewhere while this tab was stale) are PRESERVED, not
// dropped. Nothing here decides which side is "newer" per field — the goal is
// narrow and absolute: a save must never silently delete an entity.

function unionById(localRows, cloudRows) {
  const local = Array.isArray(localRows) ? localRows : [];
  const cloud = Array.isArray(cloudRows) ? cloudRows : [];
  const seen = new Set(local.map((r) => r && r.id).filter(Boolean));
  // Cloud-only rows append at the end (bottom of a top-first stack) so they
  // never shove the user's active ordering around.
  return [...local, ...cloud.filter((r) => r && r.id && !seen.has(r.id))];
}

/**
 * Merge a stale local snapshot with the current cloud snapshot.
 * Returns { state, adopted } where adopted counts cloud-only entities kept —
 * 0 means the merge is a no-op and the local snapshot was already a superset.
 */
export function mergeProjectStates(local, cloud) {
  const l = local && typeof local === 'object' ? local : {};
  const c = cloud && typeof cloud === 'object' ? cloud : {};

  const shapes = unionById(l.shapes, c.shapes);
  const overlays = unionById(l.overlays, c.overlays);
  const layers = unionById(l.layers, c.layers);
  const adopted =
    (shapes.length - (Array.isArray(l.shapes) ? l.shapes.length : 0)) +
    (overlays.length - (Array.isArray(l.overlays) ? l.overlays.length : 0)) +
    (layers.length - (Array.isArray(l.layers) ? l.layers.length : 0));

  // Keyframes stay local (times/eases can't be sanely unioned), but each
  // local keyframe adopts the cloud's per-shape entries for shapes that only
  // the cloud knew — otherwise a merged-in shape loses its animation.
  const cloudKfById = new Map(
    (Array.isArray(c.keyframes) ? c.keyframes : []).filter((k) => k && k.id).map((k) => [k.id, k]),
  );
  const localShapeIds = new Set((Array.isArray(l.shapes) ? l.shapes : []).map((s) => s && s.id));
  const keyframes = (Array.isArray(l.keyframes) ? l.keyframes : []).map((kf) => {
    const twin = kf && kf.id ? cloudKfById.get(kf.id) : null;
    if (!twin || !twin.shapes) return kf;
    const out = { ...kf, shapes: { ...(kf.shapes || {}) } };
    for (const [sid, entry] of Object.entries(twin.shapes)) {
      if (!localShapeIds.has(sid) && !out.shapes[sid]) out.shapes[sid] = entry;
    }
    return out;
  });

  // Everything singular (camera, borders, flags, active ids) is the active
  // editor's business: local wins wholesale.
  return { state: { ...c, ...l, shapes, overlays, layers, keyframes }, adopted };
}
