// roles.js — the ROLE FOCUS HUB's single source of truth.
//
// Johnny's crew each own a "craft": an animator, a 3D animator, an archive team, a
// fact-checking team, a b-roll video editor. Each craft maps to a directionMark `kind`
// (rendered as `.wp-dhl[data-kind="…"]`, see extensions/direction-chip.js) — plus, for the
// two crafts that also have a parallel legacy surface, a second selector (fact-check spans
// `[data-fc]`, b-roll blocks `[data-broll]`). The hub sets `data-roles="animation broll"`
// on `.wp-page` and PURE CSS (styles.css) fades every row that doesn't contain an active
// craft's tag. This module is DOM-free and headless-testable — no ProseMirror, no Preact.
//
// WHY a data model and not just inline CSS strings: the hub's checkbox list, the legend
// swatch tints, and the CSS selectors must never drift apart. One list, one truth.

// Each craft's directionMark kind(s). `oncam` and `direction` are deliberately ownerless
// (a director's film-this cue and an unowned catch-all) — they fade like any other viz.
export const ROLE_DEFS = [
  { id: 'animation', label: 'Animator',      tint: '#7a6ab5', sel: '.wp-dhl[data-kind="animation"]' },
  { id: '3d',        label: '3D animator',   tint: '#b8a72e', sel: '.wp-dhl[data-kind="3d"]' },
  { id: 'archive',   label: 'Archive team',  tint: '#b56b6b', sel: '.wp-dhl[data-kind="archive"]' },
  { id: 'factcheck', label: 'Fact-check',    tint: '#c0392b', sel: '.wp-dhl[data-kind="factcheck"], [data-fc]' },
  { id: 'broll',       label: 'B-roll editor', tint: '#d0873f', sel: '.wp-dhl[data-kind="broll"], [data-broll]' },
  { id: 'cartography', label: 'Cartography',   tint: '#9c5a3c', sel: '.wp-dhl[data-kind="mapdata"]' },
];

// The set of legal role ids — the gate for anything read back out of localStorage or a URL.
export const ROLE_IDS = new Set(ROLE_DEFS.map((r) => r.id));

// Parse a `data-roles` string ("animation broll") back to a clean, de-duped, order-stable
// array of KNOWN ids. Unknown tokens (a renamed craft, a typo, a hand-edited LS value) are
// dropped, never trusted — so a stale value can only ever under-filter, never crash.
export function parseRoles(str) {
  if (!str || typeof str !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const tok of str.trim().split(/\s+/)) {
    if (ROLE_IDS.has(tok) && !seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

// Serialize an id array to the space-joined attribute string CSS matches with `~=`.
// Filters to known ids so we never write a token the stylesheet can't act on.
export function serializeRoles(roles) {
  if (!Array.isArray(roles)) return '';
  const seen = new Set();
  const out = [];
  for (const id of roles) {
    if (ROLE_IDS.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.join(' ');
}

// Resolve the per-project localStorage key the role lens persists under. Prefer an explicit
// `storage.ROLES`; if a config predates the ROLES key (palau/palau2 and every scripts-library
// project were minted before the hub shipped), DERIVE a namespaced key off the WORKSHOP key —
// every episode/library config defines one (`wp01_burma_workshop_v1`, `script_palau_workshop_v1`,
// `${ns}_workshop_v1`), so the swap yields exactly that project's OWN `…_roles_…` key. Without
// this, a keyless config makes the hub read/write the LITERAL key "undefined" (localStorage
// coerces an undefined key to the string), silently sharing one lens across every such project.
// Last resort — a config with neither key — falls back to the burma default rather than "undefined".
export function rolesStorageKey(storage) {
  if (storage && typeof storage.ROLES === 'string' && storage.ROLES) return storage.ROLES;
  const ws = storage && storage.WORKSHOP;
  if (typeof ws === 'string' && /workshop/i.test(ws)) return ws.replace(/workshop/i, 'roles');
  return 'wp01_burma_roles_v1';
}

// Toggle one craft in/out of the active set (multi-hat: crews double up). Returns a new array.
export function toggleRole(roles, id) {
  if (!ROLE_IDS.has(id)) return Array.isArray(roles) ? roles.slice() : [];
  const base = parseRoles(serializeRoles(roles)); // normalize first
  return base.includes(id) ? base.filter((r) => r !== id) : [...base, id];
}
