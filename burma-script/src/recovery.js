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

const LS_DOC = 'wp01_burma_doc_v1';
const LS_DOC_VER = 'wp01_burma_doc_ver_v1';
const CONFLICT_PREFIX = LS_DOC + '.conflict.';
const BAK_PREFIX = LS_DOC + '.bak.';
const CORRUPT_PREFIX = LS_DOC + '.corrupt.';

// localStorage key for snapshots the user has explicitly dismissed (recovered or discarded), so the
// affordance does NOT nag forever once they've dealt with it. Stores a JSON array of keys.
const LS_DISMISSED = 'wp01.recovery.dismissed.v1';

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
      out.push({ key: k, kind, ts: snapshotTimestamp(k), bytes: raw.length });
    }
  } catch {
    return [];
  }
  // Newest first so the most-likely-relevant recovery is at the top.
  out.sort((a, b) => b.ts - a.ts);
  return out;
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

export { LS_DOC, LS_DOC_VER, CONFLICT_PREFIX, BAK_PREFIX, CORRUPT_PREFIX, LS_DISMISSED };
