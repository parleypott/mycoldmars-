// Burma Script Tool — STARTUP RECOVERY SURFACE (orphaned-snapshot discoverability).
//
// THE GAP THIS CLOSES
// When the cloud adopt path (or a cross-tab conflict, or a 409 push) snapshots Johnny's unsynced
// edit to a `.conflict.<ts>` / `.bak.<ts>` recovery key and then reloads the page, the React banner
// that pointed at that snapshot is DESTROYED by the reload. After reload the editor paints the cloud
// doc cleanly with no banner, and nothing in the UI ever mentions that a recovery snapshot exists.
// The bytes survive on disk but are reachable only via DevTools localStorage inspection — which for
// a dyslexic, non-coder director is effectively unreachable. The word is "not lost" but it is
// invisible, which for Johnny is the same thing.
//
// This module scans localStorage at startup for recovery snapshots that are NEWER than (or contend
// with) the doc currently on screen, and hands the caller a structured list so a PERSISTENT
// "recover unsynced edit" affordance can be surfaced. It NEVER auto-restores — restoring over the
// live doc could itself lose work (the cardinal sin). Recovery is read-only: the user can PREVIEW
// and DOWNLOAD a snapshot to a .txt, then decide for themselves. It NEVER throws and NEVER writes.

import {
  idbListSnapshots, idbReadSnapshot, idbDeleteSnapshot, idbPutSnapshot, idbAvailable,
} from './recovery-store.js';
import { getEpisodeStorage, onEpisodeChange } from './episode-config.js';

export let LS_DOC = '';
export let LS_DOC_VER = '';
export let CONFLICT_PREFIX = '';
export let BAK_PREFIX = '';
export let CORRUPT_PREFIX = '';

// localStorage key for snapshots the user has explicitly dismissed (recovered or discarded), so the
// affordance does NOT nag forever once they've dealt with it. Stores a JSON array of keys.
export let LS_DISMISSED = '';

function syncStorageKeys() {
  const storage = getEpisodeStorage();
  LS_DOC = storage.DOC;
  LS_DOC_VER = storage.DOC_VER;
  CONFLICT_PREFIX = LS_DOC + '.conflict.';
  BAK_PREFIX = LS_DOC + '.bak.';
  CORRUPT_PREFIX = LS_DOC + '.corrupt.';
  LS_DISMISSED = storage.DISMISSED;
}

onEpisodeChange(syncStorageKeys);

// Parse the trailing timestamp out of a recovery key. Keys look like:
//   wp01_burma_doc_v1.conflict.1718800000000-000001   (ms + '-' + seq, newer collision-proof form)
//   wp01_burma_doc_v1.bak.1718800000000               (ms only, older form)
// Returns the millisecond timestamp as a number, or 0 if it can't be parsed.
export function snapshotTimestamp(key) {
  try {
    const tail = key.split('.').pop() || '';            // e.g. "1718800000000-000001" or "1718800000000"
    const ms = parseInt(String(tail).split('-')[0], 10); // strip the '-seq' suffix if present
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

// Classify a key by its recovery kind for labelling. Order matters: .conflict before .bak before
// .corrupt (none overlap, but be explicit).
function kindOf(key) {
  if (key.startsWith(CONFLICT_PREFIX)) return 'conflict';
  if (key.startsWith(BAK_PREFIX)) return 'bak';
  if (key.startsWith(CORRUPT_PREFIX)) return 'corrupt';
  return 'unknown';
}

// ── CANONICAL CONTENT COMPARISON (recovery-banner-spam) ─────────────────────────────────────────
// A recovery snapshot is only worth surfacing when it holds content that DIFFERS from the doc the
// editor would paint after a clean load (the live LS_DOC). A snapshot whose content EQUALS the live
// saved doc is a REDUNDANT backup of already-saved work — there is nothing to recover from it, so it
// must NOT appear in the banner (otherwise "N unsynced backups found" never clears no matter how
// often backups are cleared, because the adopt path keeps minting content-equal copies).
//
// We compare CANONICAL content (stable JSON with sorted keys), NOT raw bytes, so a cosmetic key-order
// reflow that a cloud round-trip introduces is treated as "same content" — exactly the same stable
// serialization the churn gate (localDiffersFrom in cloud-sync.js) uses, kept byte-for-byte identical
// here so the two surfaces agree on what "same content" means. recovery.js stays dependency-light and
// browserless-testable, so we inline the helper rather than importing it. NEVER throws.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// Canonical content signature of a RAW snapshot string. Parses the JSON and serializes it with sorted
// keys so attribute/key ordering can't masquerade as different content. Returns null when the raw
// value is empty or unparseable (caller treats null as "no comparable content"). NEVER throws.
function canonicalOfRaw(raw) {
  if (!raw) return null;
  let doc = null;
  try { doc = JSON.parse(raw); } catch { return null; }
  try { return stableStringify(doc); } catch { return null; }
}

// The canonical content of the live saved doc currently on disk (LS_DOC), or null if absent /
// unparseable. A snapshot whose canonical content equals this is redundant and must be filtered out.
function liveDocCanonical(storage) {
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(LS_DOC); } catch { raw = null; }
  return canonicalOfRaw(raw);
}

// Read the dismissed-key set. NEVER throws.
function readDismissed(storage) {
  try {
    const raw = storage.getItem(LS_DISMISSED);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

// Mark a snapshot key as dismissed so the affordance stops surfacing it. NEVER throws.
// Returns true if it was persisted, false if storage refused (caller can still hide it in-memory).
export function dismissSnapshot(key, deps = {}) {
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return false;
  try {
    const set = readDismissed(storage);
    set.add(key);
    storage.setItem(LS_DISMISSED, JSON.stringify([...set]));
    return true;
  } catch {
    return false;
  }
}

// The mtime of the doc currently on disk (LS_DOC). We don't store an explicit mtime, so we use the
// LS_DOC_VER as a coarse ordering signal AND fall back to comparing snapshot timestamps directly.
// A snapshot is "interesting" (worth surfacing) when it is NOT a stale leftover that predates the
// last clean state. We keep this deliberately INCLUSIVE: false positives (surfacing a snapshot the
// user no longer needs) cost a dismiss click; false negatives (hiding a snapshot that holds the only
// copy of a lost word) cost Johnny's work. Given the cardinal rule (data loss is the worst outcome),
// we err toward surfacing. The only things we filter out are: dismissed keys, and snapshots OLDER
// than the newest snapshot the user already dismissed in this lineage is NOT filtered — we still
// show everything not explicitly dismissed.
//
// scanRecoverySnapshots — returns the recovery snapshots worth offering, newest first:
//   [{ key, kind, ts, bytes }]
// `bytes` is the raw string length (cheap size hint for the UI; never parses the JSON here).
// Dependencies injected for headless testing. NEVER throws.
export function scanRecoverySnapshots(deps = {}) {
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return [];
  let out = [];
  try {
    const dismissed = readDismissed(storage);
    const liveCanon = liveDocCanonical(storage);   // content the editor already shows after a clean load
    const seenContent = new Set();                 // canonical signatures already surfaced (content dedup)
    const n = storage.length;
    for (let i = 0; i < n; i++) {
      let k;
      try { k = storage.key(i); } catch { k = null; }
      if (!k) continue;
      const kind = kindOf(k);
      if (kind === 'unknown') continue;          // not a recovery key
      if (k === LS_DISMISSED) continue;          // our own bookkeeping
      if (dismissed.has(k)) continue;            // user already dealt with this one
      let raw = null;
      try { raw = storage.getItem(k); } catch { raw = null; }
      if (!raw) continue;                        // empty / unreadable — nothing to recover
      // REDUNDANT-BACKUP FILTER: a snapshot whose canonical content equals the live saved doc is a
      // backup of already-saved work — nothing to recover, so don't surface it (this is what kept the
      // banner stuck at "N earlier edits backed up"). Snapshots that don't parse (canon === null) are
      // still surfaced: we can't prove them redundant, and the cardinal rule errs toward NOT hiding.
      const canon = canonicalOfRaw(raw);
      if (canon != null && liveCanon != null && canon === liveCanon) continue;
      // CONTENT DEDUP: the same bytes should never show twice (two keys, identical content).
      if (canon != null) {
        if (seenContent.has(canon)) continue;
        seenContent.add(canon);
      }
      out.push({ key: k, kind, ts: snapshotTimestamp(k), bytes: raw.length, raw });
    }
  } catch {
    return [];
  }
  // Newest first so the most-likely-relevant recovery is at the top.
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

// ── PHASE 3: READ FROM BOTH STORES (recovery-idb) ──────────────────────────────────────────────
// The full-size recovery snapshots now live primarily in IndexedDB (quota: hundreds of MB), with
// legacy snapshots possibly still sitting in localStorage from before this change. The async scan
// reads BOTH, merges them (deduping by key — a snapshot mirrored to both stores appears ONCE), and
// OPPORTUNISTICALLY migrates any legacy localStorage snapshot into IDB then removes the localStorage
// copy, so the next load finds it in the big store and localStorage is freed. NEVER throws / rejects:
// resolves to the merged list, or just the localStorage list if IDB is unavailable.
//
//   [{ key, kind, ts, bytes, store }]  — `store` is 'idb' | 'ls' (where the bytes were found).
//
// `deps` mirrors scanRecoverySnapshots: { storage } for localStorage, plus { indexedDB, IDBKeyRange }
// forwarded to the IDB store for headless tests.
export async function scanRecoverySnapshotsAsync(deps = {}) {
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);

  // 1) localStorage snapshots (the legacy / fallback store) — reuse the sync scan, tag store='ls'.
  const lsSnaps = scanRecoverySnapshots({ storage }).map((s) => ({ ...s, store: 'ls' }));

  // 2) IndexedDB snapshots (the primary store going forward).
  let idbSnaps = [];
  try {
    if (idbAvailable(deps)) {
      idbSnaps = (await idbListSnapshots(deps)).map((s) => ({ ...s, store: 'idb' }));
    }
  } catch { idbSnaps = []; }

  // 3) OPPORTUNISTIC MIGRATION — copy each legacy localStorage snapshot into IDB, then drop the
  //    localStorage copy so the heavy bytes stop counting against the ~5MB quota. Best-effort: a
  //    failed migration just leaves the localStorage copy in place (still surfaced via lsSnaps).
  //    Skip ones already present in IDB (by key) so we don't write a duplicate. Never blocks the scan
  //    result on a migration failure.
  const idbKeys = new Set(idbSnaps.map((s) => s.key));
  if (storage && idbAvailable(deps) && lsSnaps.length) {
    for (const s of lsSnaps) {
      if (idbKeys.has(s.key)) {
        // Already mirrored into IDB — just reclaim the localStorage copy.
        try { storage.removeItem(s.key); } catch {}
        continue;
      }
      let raw = null;
      try { raw = storage.getItem(s.key); } catch { raw = null; }
      if (!raw) continue;
      let migrated = null;
      try { migrated = await idbPutSnapshot(s.kind, raw, deps); } catch { migrated = null; }
      if (migrated) {
        // Landed in IDB — reclaim the localStorage copy and represent it as an IDB snapshot. We keep
        // the ORIGINAL key for dedup/dismiss continuity even though idbPutSnapshot minted a new key;
        // both keys point at identical bytes, and the list dedups below so the user sees one entry.
        try { storage.removeItem(s.key); } catch {}
        idbSnaps.push({ key: migrated, kind: s.kind, ts: s.ts, bytes: s.bytes, store: 'idb', raw });
        idbKeys.add(migrated);
      }
    }
  }

  // 4) MERGE + DEDUP by key (idb wins over a same-key ls entry), newest first. Migrated entries were
  //    removed from localStorage above so their ls copy no longer exists; we still re-scan lsSnaps for
  //    any that could not be migrated (IDB unavailable / write refused) so nothing is ever hidden.
  const byKey = new Map();
  for (const s of [...idbSnaps, ...lsSnaps]) {
    const existing = byKey.get(s.key);
    if (!existing || (existing.store === 'ls' && s.store === 'idb')) byKey.set(s.key, s);
  }
  // REDUNDANT-BACKUP FILTER + CONTENT DEDUP (recovery-banner-spam). Compute each snapshot's CANONICAL
  // content signature (stable JSON, sorted keys — same as the sync scan and cloud-sync's churn gate).
  // Then:
  //   • DROP any snapshot whose canonical content equals the live saved doc (LS_DOC) — a backup of
  //     already-saved work, nothing to recover. This is the root fix for the banner never clearing.
  //   • COLLAPSE snapshots with identical canonical content to ONE entry (the same edit mirrored into
  //     both stores has different keys but identical content), preferring the IDB copy (durable) and
  //     newest ts as the representative.
  // Snapshots whose raw can't be parsed (canon === null) are NEVER dropped as redundant and never
  // collapsed by content — we can't prove them equal to anything, and the cardinal rule errs toward
  // surfacing. For those we keep the old (kind|bytes) signature so a true duplicate still collapses.
  const liveCanon = liveDocCanonical(storage);
  const out = [...byKey.values()];
  const seen = new Set();
  const deduped = [];
  for (const s of out.sort((a, b) => {
    if (a.store !== b.store) return a.store === 'idb' ? -1 : 1; // idb first
    return b.ts - a.ts;                                          // then newest first
  })) {
    // Both the IDB list and the ls scan now carry `raw` (captured at scan time, before any reclaim),
    // so the canonical content is always computable without a re-read. Fall back to a storage read
    // only if some path produced an entry without raw.
    let raw = s.raw;
    if (raw == null && s.store === 'ls' && storage) {
      try { raw = storage.getItem(s.key); } catch { raw = null; }
    }
    const canon = canonicalOfRaw(raw);
    if (canon != null && liveCanon != null && canon === liveCanon) continue; // redundant — drop
    const sig = canon != null ? 'c|' + canon : s.kind + '|' + s.bytes;       // content-first dedup
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(s);
  }
  deduped.sort((a, b) => b.ts - a.ts);
  return deduped;
}

// Read a single snapshot's parsed doc, trying IndexedDB first (where snapshots now live), then
// falling back to localStorage for legacy keys. `store` (from a scan result) is an optional hint that
// short-circuits to the right store. Resolves to the parsed object, or null. NEVER throws.
export async function readSnapshotAsync(key, deps = {}) {
  if (!key) return null;
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  // Hint says localStorage → read it directly.
  if (deps.store === 'ls') return readSnapshot(key, { storage });
  // Try IDB first (primary store), then fall back to localStorage.
  try {
    if (idbAvailable(deps)) {
      const fromIdb = await idbReadSnapshot(key, deps);
      if (fromIdb != null) return fromIdb;
    }
  } catch {}
  return readSnapshot(key, { storage });
}

// Dismiss a snapshot wherever it lives: record the dismissal (so a localStorage copy stops surfacing)
// AND delete it from IDB (so the IDB copy stops surfacing too). Best-effort — NEVER throws.
export async function dismissSnapshotAsync(key, deps = {}) {
  const persisted = dismissSnapshot(key, deps);
  try { if (idbAvailable(deps)) await idbDeleteSnapshot(key, deps); } catch {}
  return persisted;
}

// Read a single snapshot's parsed doc by key. Returns the parsed object, or null if missing /
// unparseable. NEVER throws.
export function readSnapshot(key, deps = {}) {
  const storage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Flatten a ProseMirror doc (or any nested {content:[...], text:"..."} tree) to readable plain text.
// Block-level nodes are separated by blank lines so the recovered text is legible to a human (and to
// a dyslexic reader especially). NEVER throws — best-effort extraction.
export function snapshotToText(doc) {
  if (doc == null) return '';
  const out = [];
  // Node types that should force a paragraph break around their text.
  const BLOCK = new Set(['paragraph', 'heading', 'blockquote', 'list_item', 'listItem',
    'bullet_list', 'bulletList', 'ordered_list', 'orderedList', 'code_block', 'codeBlock', 'block']);
  function walk(node, depth) {
    if (node == null) return;
    if (typeof node === 'string') { out.push(node); return; }
    if (Array.isArray(node)) { node.forEach((c) => walk(c, depth)); return; }
    const isBlock = node.type && BLOCK.has(node.type);
    if (typeof node.text === 'string') out.push(node.text);
    if (Array.isArray(node.content)) {
      if (isBlock && out.length && out[out.length - 1] !== '\n\n') out.push('\n\n');
      node.content.forEach((c) => walk(c, depth + 1));
      if (isBlock) out.push('\n\n');
    }
  }
  try { walk(doc.doc || doc, 0); } catch {}
  // Collapse runs of blank lines, trim ends.
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}
