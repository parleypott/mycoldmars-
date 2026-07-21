// Burma Script Tool — PER-WORKSPACE ROW CHECK-OFF (view-local "done" state).
//
// Johnny: "Editors should be able to check off each row within their workspace. It
// shouldn't affect anything on the main script — just in their view." So this state is
// PURELY PER-PERSON, PER-BROWSER, PER-WORKSPACE — it never touches the document, never
// rides a collab transaction, is invisible to everyone else and to the master script.
// An animator marks a row done; a green medallion says so IN THEIR CUTOUT VIEW ONLY.
//
// PERSISTENCE: localStorage, keyed per project × per craft workspace, holding an array
// of row identities (firstBlockId — the SAME stable row identity workspaces.js walkRows
// uses for the sticky snapshot, the section anchors and the jump pill). So a check
// survives reload and switching craft/back, but stays scoped to that one workspace.
//
// Unlike the per-visit EXPANSION state (orientation, reset on re-entry), checks are
// DURABLE across visits — progress is a lasting thing, orientation is momentary.
//
// PRUNE ON LOAD: a stored id whose ROW no longer exists (deleted, or re-identified) is
// silently dropped when the workspace is entered — a check can never resurrect a ghost.
// A row that merely lost the craft's tag (went sticky "left") keeps its check: its row,
// hence its identity, is still in the doc.
//
// STORAGE KEY NAMESPACE: derived off the episode's own storage namespace exactly like
// roles.js rolesStorageKey — NEVER hardcode 'burma'. Every episode/library config
// defines a WORKSHOP key (`wp01_burma_workshop_v1`, `script_palau_workshop_v1`,
// `${ns}_workshop_v1`); we strip its `_workshop…` tail to a clean per-project token so
// each project keeps its OWN check-off state and two projects can never share one.

import { workspaceRole, rowIsMember, walkRows } from '../workspaces.js';

// The clean per-project token behind every check-off key. Prefer WORKSHOP (every config
// has one — the rolesStorageKey doctrine); fall back to DOC; last resort the burma default
// rather than the literal string "undefined" a keyless config would otherwise coerce to.
function projectNamespace(storage) {
  const ws = storage && storage.WORKSHOP;
  if (typeof ws === 'string' && /_workshop/i.test(ws)) return ws.replace(/_workshop.*$/i, '');
  const doc = storage && storage.DOC;
  if (typeof doc === 'string' && /_doc/i.test(doc)) return doc.replace(/_doc.*$/i, '');
  return 'wp01_burma';
}

// The localStorage key one project's ONE workspace persists its checked rows under:
//   wp_wsdone_<projectNamespace>_<workspaceKey>   e.g. wp_wsdone_wp01_burma_broll
export function wsDoneStorageKey(storage, wsKey) {
  return `wp_wsdone_${projectNamespace(storage)}_${String(wsKey || '')}`;
}

// Read the persisted checked set (Set<firstBlockId>). Guarded end-to-end: a locked-down /
// private-mode localStorage, a missing key, or a hand-corrupted value all yield an empty
// set rather than throwing into the plugin's apply().
export function readChecked(storage, wsKey) {
  const set = new Set();
  if (!wsKey) return set;
  try {
    const raw = localStorage.getItem(wsDoneStorageKey(storage, wsKey));
    if (!raw) return set;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const id of arr) if (typeof id === 'string' && id) set.add(id);
  } catch {}
  return set;
}

// Persist the checked set. Empty → REMOVE the key (leave no orphan behind). Guarded so a
// quota/private-mode failure is a silent no-op, never a thrown transaction.
export function writeChecked(storage, wsKey, set) {
  if (!wsKey) return;
  try {
    const key = wsDoneStorageKey(storage, wsKey);
    const arr = set && set.size ? [...set] : [];
    if (arr.length) localStorage.setItem(key, JSON.stringify(arr));
    else localStorage.removeItem(key);
  } catch {}
}

// Drop any checked id whose row is no longer in the doc. `liveIds` is the set of EVERY
// current row identity (walkRows firstBlockIds), not just members — a row that went sticky
// "left" is still a live row and keeps its check. Returns the SAME Set when nothing was
// pruned, so the plugin can cheaply tell whether it needs to re-persist.
export function pruneChecked(checked, liveIds) {
  if (!checked || !checked.size) return checked || new Set();
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || []);
  let pruned = null;
  for (const id of checked) {
    if (!live.has(id)) { if (!pruned) pruned = new Set(checked); pruned.delete(id); }
  }
  return pruned || checked;
}

// Count checked rows that are CURRENTLY MEMBERS of the craft (the hub's "DONE n" — n rows
// the person has checked off among the m member rows now in view). A checked row that has
// gone sticky "left" is present on screen but is not a member, so it does not count toward
// n — keeping n ≤ m and both member-based, consistent with the hub's ROW count (= m).
export function countCheckedMembers(doc, roleKey, checked) {
  if (!checked || !checked.size) return 0;
  const role = workspaceRole(roleKey);
  if (!role || !doc) return 0;
  let n = 0;
  for (const r of walkRows(doc)) {
    if (r.firstBlockId && checked.has(r.firstBlockId) && rowIsMember(r.node, role)) n += 1;
  }
  return n;
}
