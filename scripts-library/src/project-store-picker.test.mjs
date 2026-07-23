// Tests for project-store's PER-PROJECT PICKER config — patchPickerEntry (the durable write the
// timecode picker fires), reconcileCloudRow's config union, and hydrateProjectConfig (the read-back).
//
// This is the PERSISTENCE half of "add day 4 and have it stick": the picker adds a day/sequence, this
// module writes it to the cache (reload survival) and PATCHes the cloud (teammate/cross-device sync),
// and the union-on-read-back guarantees a near-simultaneous teammate add isn't clobbered.
//
// Load-bearing properties locked here:
//   • patchPickerEntry writes the addition into the cache row's config.picker and fires ONE cloud PATCH
//     carrying the whole config bag.
//   • a dup / invalid add is a no-op (no wasted cloud write).
//   • a local-only row (no cloudId) persists to cache but never touches the cloud.
//   • reconcileCloudRow UNIONS the cloud config with the local one (neither side's picker adds lost).
//   • hydrateProjectConfig pulls ?id= and unions the returned config into the cache.
//
// Run: bun scripts-library/src/project-store-picker.test.mjs

// ── shims ───────────────────────────────────────────────────────────────────────
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
  clear: () => _store.clear(),
};
globalThis.window = { dispatchEvent: () => true };
globalThis.CustomEvent = class { constructor(t, d) { this.type = t; this.detail = d && d.detail; } };

// Controllable fetch: records calls; returns whatever `fetchImpl` decides. Each PATCH/GET resolves to a
// { project } shape like the real endpoint (projectView).
let calls = [];
let fetchImpl = null;
globalThis.fetch = async (url, init = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method, body });
  if (fetchImpl) return fetchImpl({ url: String(url), method, body });
  return { ok: false, status: 0, json: async () => null };
};
const jsonRes = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });

const {
  INDEX_KEY, patchPickerEntry, projectConfig, hydrateProjectConfig, findById,
} = await import('./project-store.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.error(`FAIL ${label}`); } };
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
const seed = (rows) => localStorage.setItem(INDEX_KEY, JSON.stringify(rows));
const reset = () => { _store.clear(); calls = []; fetchImpl = null; };
const flush = () => new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget PATCH .then run

// ── 1. cloud-backed row: add day 4 → cache updated + ONE cloud PATCH with the config ──
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', title: 'Nile', config: {} }]);
  fetchImpl = ({ method, body }) => {
    if (method === 'PATCH') return jsonRes({ project: { id: 'c1', slug: 'nile', title: 'Nile', config: body.config } });
    return jsonRes(null, 404);
  };
  const cfg = patchPickerEntry('p1', 'day', 4);
  eq(cfg.picker.days, [4], 'returned config carries day 4');
  eq(projectConfig('p1').picker.days, [4], 'cache row updated with day 4');
  await flush();
  const patches = calls.filter((c) => c.method === 'PATCH');
  eq(patches.length, 1, 'exactly one cloud PATCH fired');
  ok(patches[0].url.includes('id=c1'), 'PATCH targeted the cloudId');
  eq(patches[0].body.config.picker.days, [4], 'PATCH carried the picker config');
}

// ── 2. dup add → no-op, NO extra cloud write ──
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', title: 'Nile', config: { picker: { days: [4], sequences: [] } } }]);
  fetchImpl = ({ body }) => jsonRes({ project: { id: 'c1', config: body.config } });
  patchPickerEntry('p1', 'day', 4); // already present
  await flush();
  eq(calls.filter((c) => c.method === 'PATCH').length, 0, 'dup day fired NO cloud PATCH');
  patchPickerEntry('p1', 'day', 10); // invalid (out of range)
  await flush();
  eq(calls.filter((c) => c.method === 'PATCH').length, 0, 'invalid day fired NO cloud PATCH');
}

// ── 3. sequence add: cleaned + persisted ──
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', title: 'Nile', config: {} }]);
  fetchImpl = ({ body }) => jsonRes({ project: { id: 'c1', config: body.config } });
  const cfg = patchPickerEntry('p1', 'sequence', ' • Boatman - Interview: ');
  eq(cfg.picker.sequences, ['Boatman - Interview:'], 'sequence cleaned + stored');
}

// ── 4. local-only row (no cloudId): cache persists, cloud untouched ──
{
  reset();
  seed([{ id: 'local_x', slug: 'draft', title: 'Draft', config: {} }]);
  const cfg = patchPickerEntry('local_x', 'day', 4);
  eq(cfg.picker.days, [4], 'local row config updated');
  await flush();
  eq(calls.length, 0, 'local-only row fired NO cloud call');
}

// ── 5. unknown id / guest (no id) → null, no throw, no write ──
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', config: {} }]);
  ok(patchPickerEntry('nope', 'day', 4) === null, 'unknown id → null');
  ok(patchPickerEntry(null, 'day', 4) === null, 'missing id → null');
  ok(patchPickerEntry(undefined, 'day', 4) === null, 'undefined id → null');
  await flush();
  eq(calls.length, 0, 'no cloud call for a missing row');
}

// ── 6. reconcileCloudRow union: a cloud add + a local add both survive ──
// Drive it through the PATCH response path: local has day 5 already; the cloud PATCH echoes a config with
// day 4 (a teammate's add the server merged in). The reconcile must UNION → [4,5], not clobber to [4].
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', title: 'Nile', config: { picker: { days: [5], sequences: [] } } }]);
  fetchImpl = ({ body }) => {
    // Server returns a config that ALSO holds a teammate's day 4 (union of their add + ours).
    const merged = { picker: { days: [4, ...(body.config.picker.days || [])], sequences: [] } };
    return jsonRes({ project: { id: 'c1', slug: 'nile', config: merged } });
  };
  patchPickerEntry('p1', 'sequence', 'X:'); // triggers a PATCH whose response carries day 4
  await flush();
  const days = projectConfig('p1').picker.days;
  ok(days.includes(4) && days.includes(5), `cloud day 4 + local day 5 both survive (got ${JSON.stringify(days)})`);
}

// ── 7. hydrateProjectConfig: GET ?id= → union into cache ──
{
  reset();
  seed([{ id: 'p1', cloudId: 'c1', slug: 'nile', title: 'Nile', config: { picker: { days: [5], sequences: [] } } }]);
  fetchImpl = ({ method, url }) => {
    if (method === 'GET' && url.includes('id=c1')) {
      return jsonRes({ project: { id: 'c1', slug: 'nile', config: { picker: { days: [4], sequences: ['Teammate:'] } } } });
    }
    return jsonRes(null, 404);
  };
  const okHydrate = await hydrateProjectConfig({ id: 'p1', cloudId: 'c1' });
  ok(okHydrate === true, 'hydrate reported success');
  const cfg = projectConfig('p1');
  ok(cfg.picker.days.includes(4) && cfg.picker.days.includes(5), `hydrate unioned days (got ${JSON.stringify(cfg.picker.days)})`);
  eq(cfg.picker.sequences, ['Teammate:'], 'hydrate pulled the teammate sequence');
}

// ── 8. hydrate no-ops safely for a local-only row (no cloudId) ──
{
  reset();
  const okHydrate = await hydrateProjectConfig({ id: 'local_x' });
  ok(okHydrate === false, 'no cloudId → hydrate is a no-op');
  eq(calls.length, 0, 'no cloud GET fired');
}

if (fail === 0) console.log(`PASS — all ${pass} project-store picker cases correct`);
else { console.log(`FAIL — ${fail} of ${pass + fail} project-store picker cases failed`); process.exit(1); }
