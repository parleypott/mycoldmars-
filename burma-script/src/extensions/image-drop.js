// Burma Script Tool — IMAGE DROP/PASTE (drag a still into the rack, e.g. the SHOWN column).
//
// Before this extension the engine had NO file-drop handling at all: ProseMirror
// preventDefault()s dragover (making the editor a valid drop target) but its default drop
// handler can only parse text/html|text/plain — a Finder image drag carries only `Files`,
// so PM bailed WITHOUT preventDefault and the browser executed its default action:
// NAVIGATE THE TAB to the dropped image, replacing the editor mid-session. This plugin
// closes that trap (every file drop over the editor is swallowed) and turns image drops
// into persisted imageBlock nodes.
//
// This is an Extension, NOT a Node — it adds ZERO schema, so the Editor.jsx /
// migrate-doc.js mirror-schema lockstep is untouched (same posture as FindReplace). The
// imageBlock node it inserts already exists in BURMA_NODES and already round-trips
// docToBlocks / the save-gate schema losslessly (image-block.test.mjs).
//
// THE BYTES-NEVER-IN-THE-DOC LAW: the doc is persisted whole to localStorage (~5MB origin
// budget; quota-escalation.test.mjs documents a real quota failure at ~167KB), IndexedDB,
// /api/script-doc, a FULL COPY per autosave into script_doc_revisions, and the Yjs collab
// room. So we upload the bytes FIRST (/api/script-image-upload → public Supabase CDN URL)
// and only the ~100-byte URL ever enters the doc. While the upload is in flight the drop
// point is held by a WIDGET DECORATION (the canonical ProseMirror upload-placeholder
// pattern): decorations are not doc state — no history step, no collab payload, nothing to
// autosave — and the placeholder's position maps through local transactions via tr.mapping.
// If an edit DELETES the placeholder (row removed, undo), the insert ABORTS with a toast —
// never clamps to a stale/wrong position (silent structural corruption is the failure class
// this kills).
//
// COLLAB SURVIVAL (enterprise-audit HIGH): numeric tr.mapping does NOT survive a y-sync
// apply — the binding lands every remote change as a FULL-DOC replace (see the COLLAB LOOP
// LAW), and DecorationSet.map drops any widget inside a replaced range, so a teammate's
// single keystroke used to kill the placeholder and abort every image drop under active
// collab. Fix: alongside the DecorationSet we keep per-placeholder Yjs RELATIVE-POSITION
// anchors (the same mechanism collab carets use — they survive full-doc replaces by
// construction). On a y-sync transaction we REBUILD the widgets from their anchors instead
// of mapping. The anchor adapter is INJECTED by collab-runtime.js at session start
// (setImageDropCollabAnchors) because this file is core-chunk and may not import
// @tiptap/y-tiptap; with no adapter registered (non-collab), behavior is byte-identical
// to the pre-fix engine.
//
// ONE-TRANSACTION LAW: the final insert is a single tr carrying the node with its FINAL
// attrs (no insert-then-patch) + the remove-placeholder meta — one undo removes the image
// byte-exact, and the tr rides the existing autosave debounce / Yjs binding unchanged.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Slice, Fragment } from '@tiptap/pm/model';
import { dropPoint } from '@tiptap/pm/transform';
import { isReadOnly } from '../read-mode.js';
import { getEpisode, episodeFlag } from '../episode-config.js';
import { mintUserPairId } from './table.js';
import { offerMediaOrQuote, startImageQuote, parseTranscriptText, insertQuoteRow } from './transcript-drop.js';

export const imageDropKey = new PluginKey('burmaImageDrop');

// COLLAB ANCHOR ADAPTER — registered by collab-runtime.js (collab chunk) at session start.
// Shape: { isRemote(tr), toRel(state, pos) → opaque anchor | null, toAbs(state, anchor) →
// pos | null }. null adapter = non-collab session = the plugin's original numeric behavior.
let collabAnchors = null;
export function setImageDropCollabAnchors(adapter) { collabAnchors = adapter || null; }

// Client-side mime allow-list — deliberately the SAME set the server's imageStorageMeta
// stores (png/jpeg/webp/gif; image/jpg is the non-canonical jpeg spelling it normalizes).
// Anything else — notably HEIC from macOS Photos — is rejected HERE with a toast: the
// server would coerce its Content-Type to png WITHOUT transcoding the bytes, producing a
// broken render that would then persist into every doc revision.
// image/gif added 2026-07-07 — animated reference GIFs; <img> plays them looping natively.
export const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

// VIDEO clipboard/drop support (2026-07-21) — a pasted or dropped video lands as an imageBlock
// whose src ends in a video container, rendered as a looping <video> by the same nodeview that
// plays gif→mp4 output (blocks.js isVideoSrc). mp4/webm play natively everywhere; mov (macOS
// screen recordings / Finder copies, type video/quicktime) plays in Safari and any H.264-capable
// browser. All three ride the SIGNED road only (the base64 edge fn would coerce video → png) and
// mirror the server's SIGNABLE_MIMES video set (api/script-image-sign.js).
export const SUPPORTED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
export function isSupportedMediaMime(type) {
  const t = String(type || '').toLowerCase();
  return SUPPORTED_IMAGE_MIMES.has(t) || SUPPORTED_VIDEO_MIMES.has(t);
}

// AUDIO drop/paste support (2026-07-24) — Johnny drops audio (wav / mp3 / m4a / a QuickTime ".qta"
// voice memo). Audio lands as its OWN node type (audioBlock, a waveform strip) — never an imageBlock.
// Weird containers are transcoded to mp3 client-side before upload (audio-transcode.js); wav/mp3 go
// as-is. Every audio upload rides the SIGNED road (the base64 edge fn would coerce audio → png).
//
// DETECTION BY EXTENSION, NOT MIME ALONE (the .qta problem): a macOS voice memo ".qta" reports its
// type as video/quicktime — or EMPTY — from Finder, so a MIME-only check would misroute it to the
// video path (a broken <video>). We detect audio by a KNOWN AUDIO EXTENSION first (which wins the
// .qta case over the shared video/quicktime mime) OR an explicit audio/* mime. The final proof that
// a .qta really is decodable audio is decodeAudioData succeeding at transcode time (audio-transcode.js).
export const SUPPORTED_AUDIO_MIMES = new Set([
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
  'audio/mpeg', 'audio/mp3',
  'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac',
  'audio/ogg', 'audio/opus', 'audio/flac', 'audio/x-flac',
  'audio/aiff', 'audio/x-aiff', 'audio/basic',
]);
// Filename-extension gate — the load-bearing signal for the .qta (and any empty-typed audio). Ordered
// alternation of the containers a browser's decodeAudioData can realistically decode plus the ones the
// mp3 transcode handles.
export const AUDIO_EXT_RE = /\.(wav|mp3|m4a|aac|qta|aif|aiff|caf|ogg|oga|opus|flac|weba|amr|3gp|wma)$/i;
export function isAudioFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (SUPPORTED_AUDIO_MIMES.has(type)) return true;
  // Extension wins over a misleading container mime (video/quicktime on a .qta) or an empty type.
  if (AUDIO_EXT_RE.test(String(file?.name || ''))) return true;
  return false;
}

// PURE TRANSCODE DECISION — 'passthrough' (already a web-playable mp3/wav, upload the bytes as-is,
// NO needless re-encode) vs 'transcode' (m4a / aac / .qta / ogg / flac / anything else → mp3 via
// audio-transcode.js). Exported so the convert-vs-pass boundary is a locked, testable contract with
// NO WebAudio dependency (the encode itself is a live-browser path).
export function audioTranscodeDecision(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '');
  const isMp3 = type === 'audio/mpeg' || type === 'audio/mp3' || /\.mp3$/i.test(name);
  const isWav = type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave' || type === 'audio/vnd.wave' || /\.wav$/i.test(name);
  return (isMp3 || isWav) ? 'passthrough' : 'transcode';
}

// Non-passthrough audio (m4a/aac/.qta/ogg/flac) rides the decode→encode transcode path, whose cost —
// full float PCM in memory (a 128s stereo clip ≈ 45MB) plus a CPU-bound re-encode — scales with
// DURATION, not just byte count. The 100MB image ceiling is far too generous for it: a compressed
// container that large is tens of minutes long and would decode into hundreds of MB of PCM and take
// tens of seconds to encode. So the transcode INPUT gets its own, much smaller ceiling. Bytes are a
// coarse proxy for duration (compression ratios vary), so this is a blunt guard against the pathological
// drop, deliberately well above Johnny's real material (his Boat Nile .qta is 8.3MB). Passthrough
// wav/mp3 keep MAX_IMAGE_BYTES — they're never decoded, just uploaded.
export const MAX_AUDIO_TRANSCODE_BYTES = 30 * 1024 * 1024;

// The oversize ceiling for a given audio file: the small transcode cap for convert-me formats, the
// full media cap for passthrough wav/mp3. Exported so the boundary is a locked, testable contract.
export function audioSizeCeiling(file) {
  return audioTranscodeDecision(file) === 'transcode' ? MAX_AUDIO_TRANSCODE_BYTES : MAX_IMAGE_BYTES;
}
// null when the file fits; otherwise the exact toast to show. Keeps the message honest about WHICH cap
// (a 40MB .qta is "over 30MB", a 120MB wav is "over 100MB") so the reason is never mysterious.
export function audioOversizeToast(file) {
  const cap = audioSizeCeiling(file);
  if (!(file?.size > cap)) return null;
  return `"${file?.name}" is over ${Math.round(cap / 1024 / 1024)}MB — too big for the script rack`;
}

// ROUTE SPLIT — bytes travel one of two roads, both ending at the same bucket + the same
// ~100-byte public URL in the doc:
//   • small files → /api/script-image-upload (base64 JSON through the edge fn; proven path)
//   • big files (a 20MB reference GIF) → /api/script-image-sign mints a signed URL and the
//     browser PUTs the bytes STRAIGHT to Supabase storage — the edge fn's ~4.5MB body
//     ceiling never sees them.
//
// ROUTE BY THE WIRE ENVELOPE, NOT THE RAW BYTES (Johnny 2026-07-22, "adding images fails —
// http 413 — the picture was NOT added"). The base64 road doesn't send the file; it sends a
// JSON body carrying the bytes as base64 — which inflates by 4/3 — plus the block_id / mimeType
// / 64-char contentHash wrapper. A 4.5MB photo is only 4.5MB on disk but ~6MB on the wire, and
// the platform (Vercel) rejects a request BODY over ~4.5MB with a 413 BEFORE the function even
// runs. The old comparator gated on RAW size at 6MB, so every ~3.3–6MB photo took the base64
// road and 413'd. We now gate on the REAL envelope size at a conservative 3.5MB (≈1MB under the
// platform ceiling) — anything larger takes the signed road, which never base64-inflates.
export const MAX_BASE64_BODY_BYTES = Math.floor(3.5 * 1024 * 1024);
// Fixed JSON-wrapper allowance around the base64 payload (keys + project id + block_id +
// mimeType + 64-hex contentHash + braces/quotes/commas). 512 is deliberately generous so the
// estimate never UNDER-counts the envelope and lets a near-ceiling body slip onto the base64 road.
export const BASE64_ENVELOPE_OVERHEAD = 512;
// Exact wire size of the base64 edge-fn JSON body for a file of `sizeBytes`: base64 is
// ceil(n/3)*4 chars, plus the fixed wrapper above.
export function base64EnvelopeBytes(sizeBytes) {
  const n = Math.max(0, Number(sizeBytes) || 0);
  return Math.ceil(n / 3) * 4 + BASE64_ENVELOPE_OVERHEAD;
}
// The largest RAW file whose base64 envelope still fits under MAX_BASE64_BODY_BYTES — the
// DERIVED base64/​signed boundary (was a hardcoded 6MB). Files at/under this ride base64; larger
// → signed. Kept as an exported constant so the boundary stays a locked, testable contract.
export const SIGNED_ROUTE_MIN_BYTES = Math.floor((MAX_BASE64_BODY_BYTES - BASE64_ENVELOPE_OVERHEAD) / 4) * 3;
// Hard client ceiling — matches MAX_SIGNED_BYTES on /api/script-image-sign. Rejecting here
// gives an instant, named toast instead of a slow round-trip to a 413.
// 100MB (was 25MB): Johnny's real MapKeys reference GIFs run 60MB+ — a 61MB one PUT to the
// bucket in ~4s, verified 2026-07-07. Storage is the cheap part; a silent size wall is not.
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

// Pure route decision, keyed on the base64 wire ENVELOPE (not the raw byte count). A file whose
// envelope could exceed the platform body ceiling mints a signed URL and PUTs the raw bytes
// browser→Supabase, dodging the ceiling entirely; everything smaller stays on the proven base64
// edge route. Exported so the boundary is a locked contract — the whole big-GIF feature rests on
// a 20MB file taking the signed road, AND a 4.5MB photo must too.
export function pickUploadRoute(sizeBytes) {
  return base64EnvelopeBytes(sizeBytes) > MAX_BASE64_BODY_BYTES ? 'signed' : 'base64';
}

// Route decision for a media upload. ANY video/* ALWAYS rides the signed road regardless of
// size: only /api/script-image-sign speaks video (its local mediaStorageMeta wrapper) — the
// base64 edge fn's shared imageStorageMeta would coerce a video → image/png, serving the bytes
// with a png Content-Type (a permanently broken render in every doc revision). This covers the
// gif→mp4 transcode output AND direct video pastes/drops. Images route by size exactly as before.
export function pickMediaUploadRoute(mime, sizeBytes) {
  const m = String(mime || '').toLowerCase();
  // Video AND audio always ride the signed road: only /api/script-image-sign speaks these media
  // types (its local mediaStorageMeta). The base64 edge fn's shared imageStorageMeta would coerce
  // them → image/png, serving the bytes with a png Content-Type (a permanently broken render/play).
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'signed';
  return pickUploadRoute(sizeBytes);
}

// Pure: split a FileList/array into supported images vs everything else. (Kept image-only — the
// existing drop path + its test rest on this exact filter.)
export function pickImageFiles(files) {
  const images = [];
  const rejected = [];
  for (const f of Array.from(files || [])) {
    const type = String(f?.type || '').toLowerCase();
    if (SUPPORTED_IMAGE_MIMES.has(type)) images.push(f);
    else rejected.push(f);
  }
  return { images, rejected };
}

// Pure: split a FileList/array into supported MEDIA (images ∪ videos) vs everything else.
// The paste + drop handlers use this so a pasted/dropped video lands as its own row. Anything
// off the allow-list (HEIC from macOS Photos, PDFs, arbitrary files) is rejected with a toast.
export function pickMediaFiles(files) {
  const media = [];
  const rejected = [];
  for (const f of Array.from(files || [])) {
    if (isSupportedMediaMime(f?.type)) media.push(f);
    else rejected.push(f);
  }
  return { media, rejected };
}

// Same shape as the seeded palau2 image ids ('image_test_1') / slash-menu's mintBlockId.
// The id doubles as the upload's block_id, so the storage path names the block it feeds.
export function mintImageBlockId() {
  return 'image_' + Math.random().toString(36).slice(2, 9);
}

// Audio block id — same shape, own prefix so the storage path (block_id) names it as audio.
export function mintAudioBlockId() {
  return 'audio_' + Math.random().toString(36).slice(2, 9);
}

// Caption default: the filename without its extension (editable later via attrs).
export function altFromFilename(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

// THE GUARD that makes byte-srcs structurally impossible: only an absolute http(s) URL or
// a root-relative bundled path (the existing /palau2/img/* shape) may enter the doc.
// data:/blob:/javascript:/everything-else is refused — a data: URL would replicate
// megabytes into every persistence sink, and a blob: URL dies on reload and would ship a
// permanently broken src to every collaborator and revision.
export function isSafeImageSrc(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/') && !s.startsWith('//')) return true;
  return false;
}

// Refine a raw coordinate-derived position to a LEGAL insertion point for an imageBlock
// using PM's own dropPoint (the same routine PM's default drop uses). tableCell content is
// 'block+' and imageBlock is group:'block', so a drop over a shown cell lands INSIDE that
// cell rather than between rows. Returns null when no legal point exists — caller aborts.
export function resolveDropPos(state, rawPos) {
  const type = state.schema.nodes.imageBlock;
  if (!type) return null;
  const probe = new Slice(Fragment.from(type.create()), 0, 0);
  return dropPoint(state.doc, rawPos, probe);
}

// Placeholder CRUD — all meta-only transactions (decorations are not doc content: no
// history step, no autosave, no collab payload).
export function addPlaceholderTr(state, pos, id) {
  return state.tr.setMeta(imageDropKey, { add: { pos, id } }).setMeta('addToHistory', false);
}

export function removePlaceholderTr(state, id) {
  return state.tr.setMeta(imageDropKey, { remove: { id } }).setMeta('addToHistory', false);
}

// Read the placeholder's CURRENT (mapped) position. null = deleted by an edit → abort.
export function findPlaceholderPos(state, id) {
  const value = imageDropKey.getState(state);
  const set = value && value.set;
  if (!set) return null;
  const found = set.find(undefined, undefined, (spec) => spec.id === id);
  return found.length ? found[0].from : null;
}

// The ONE transaction that lands the image: create the node with its FINAL attrs at the
// placeholder's mapped position and clear the placeholder in the same tr. Returns null
// (caller aborts + toasts) when the placeholder is gone, the src is unsafe, or the mapped
// position is no longer a legal insertion point — never a partial/patched insert.
//
// `select` (⌘⌃M hotkey path): also put a NodeSelection ON the just-inserted image in the SAME
// tr. The hotkey lands media into a possibly-BLURRED editor (keypress + async upload, no mouse in
// the doc), which is exactly the state the blocks.js FOCUS-RACE FIX guards against — the first
// click would take a focus transition and the selection frame would flash then vanish. Landing on
// a NodeSelection (paired with the caller's view.focus()) leaves the editor in the same
// already-focused-and-selected state a second click reaches, so the FIRST real click holds. Drops
// pass no flag (mouse is already in the doc, focus is fine) → selection behavior unchanged.
export function insertImageTr(state, id, { src, alt = '', kind = 'shot', select = false }) {
  if (!isSafeImageSrc(src)) return null;
  const pos = findPlaceholderPos(state, id);
  if (pos == null) return null;
  const type = state.schema.nodes.imageBlock;
  if (!type) return null;
  try {
    const node = type.create({ blockId: id, src: String(src), alt: String(alt || ''), kind });
    const tr = state.tr.insert(pos, node);
    tr.setMeta(imageDropKey, { remove: { id } });
    if (select) {
      try { tr.setSelection(NodeSelection.create(tr.doc, pos)); } catch {}
    }
    return tr;
  } catch {
    return null; // mapped pos became structurally illegal — abort, never clamp
  }
}

// Widget DOM is built lazily (function form) so the plugin is fully headless-testable —
// no document access until a real view renders the decoration.
//
// PLACEHOLDER LABELS — the widget's text is looked up per drop id so a long-running
// stage (the gif→mp4 transcode) can narrate itself in place. The map (not the DOM) is
// the source of truth because a y-sync apply REBUILDS every widget from its anchor —
// a label written only to the live element would silently revert on a teammate's
// keystroke. setPlaceholderLabel updates both; uploadAndInsert clears the entry when
// the drop resolves either way, so the map can't leak across drops.
const placeholderLabels = new Map();
const PLACEHOLDER_DEFAULT_LABEL = 'UPLOADING IMAGE…';
function setPlaceholderLabel(view, id, text) {
  if (text == null) placeholderLabels.delete(id);
  else placeholderLabels.set(id, text);
  try {
    const live = view?.dom?.querySelectorAll?.(`.wp-image-uploading[data-drop-id="${id}"]`) || [];
    for (const n of live) n.textContent = text ?? PLACEHOLDER_DEFAULT_LABEL;
  } catch {}
}
function placeholderDom(id) {
  const el = document.createElement('span');
  el.className = 'wp-image-uploading';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('data-drop-id', String(id || ''));
  el.textContent = placeholderLabels.get(id) || PLACEHOLDER_DEFAULT_LABEL;
  return el;
}

function toast(msg, tone = 'error') {
  try { window.dispatchEvent(new CustomEvent('wp-toast', { detail: { tone, msg } })); } catch {}
}

// CONTENT HASH for dedupe — SHA-256 of the FINAL bytes (post gif→mp4 transcode, since both roads
// receive `upload`). The server names the object by this hash and, if an identical object already
// exists, reuses it and skips storing the bytes a second time (identical drop, or the same reference
// used across scripts). Best-effort: no SubtleCrypto (older/insecure context) or any error → '' →
// the server falls back to the original stamped path, byte-for-byte as before dedupe existed.
async function sha256Hex(file) {
  try {
    if (!(globalThis.crypto && crypto.subtle && typeof crypto.subtle.digest === 'function')) return '';
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  } catch { return ''; }
}

// FileReader → bare base64 (strip the data:*;base64, prefix — the endpoint wants raw).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || '');
      const at = s.indexOf('base64,');
      resolve(at >= 0 ? s.slice(at + 7) : s);
    };
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
}

// Small-file road: bytes as base64 JSON through the edge function (the original path).
async function uploadViaBase64(file, id) {
  const [dataBase64, contentHash] = await Promise.all([fileToBase64(file), sha256Hex(file)]);
  // The scripts-library gate's fetch interceptor injects the signed-in JWT on
  // same-origin /api/* calls, so this request is authed for free in editable sessions.
  const res = await fetch('/api/script-image-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: getEpisode().id,
      block_id: id,
      dataBase64,
      mimeType: file.type,
      contentHash,
    }),
  });
  const out = await res.json().catch(() => null);
  if (res.ok && out && out.ok && out.url) return { url: out.url };
  // status rides along so runMediaUpload can tell a body-too-large 413 (retry via the signed
  // road) apart from a real failure (surface it). A platform-level 413 rejects the body BEFORE
  // the function runs, so `out` is often null — read the raw status, not just out.error.
  return { error: (out && out.error) || `http ${res.status}`, status: res.status };
}

// Did the base64 edge road fail because the request BODY was too large (the platform's ~4.5MB
// gate, or the function's decoded-bytes 413)? Either way the SAME bytes belong on the signed road.
function isPayloadTooLarge(out) {
  if (!out) return false;
  if (out.status === 413) return true;
  const e = String(out.error || '');
  return /\b413\b/.test(e) || /image_too_large|payload.*too.*large|too.*large/i.test(e);
}

// Run a media upload, SELF-HEALING past a base64-road 413. The envelope-aware route decision
// already keeps a near-ceiling file off the base64 road, but a body limit can shift (a platform
// change, an unusually incompressible file, an estimate that came up short) — so if the base64
// edge fn 413s anyway, we AUTOMATICALLY re-run the exact same bytes down the signed road before
// surfacing anything. The caller only ever shows a failure toast when BOTH roads fail. Dedupe
// (contentHash) is intact on both roads, so a fallback never double-stores.
export async function runMediaUpload(upload, id) {
  if (pickMediaUploadRoute(upload.type, upload.size) === 'signed') {
    return uploadViaSignedUrl(upload, id);
  }
  const out = await uploadViaBase64(upload, id);
  if (out.url || !isPayloadTooLarge(out)) return out;
  // The base64 body hit the ceiling despite the route estimate — heal onto the signed road. Its
  // result wins: a success returns the url; a second failure surfaces the signed road's error.
  return uploadViaSignedUrl(upload, id);
}

// Big-file road: mint a signed URL (auth + mime coercion + path minting server-side), then
// PUT the raw bytes browser → Supabase directly. No base64 inflation, no edge body ceiling.
async function uploadViaSignedUrl(file, id) {
  const contentHash = await sha256Hex(file);
  const res = await fetch('/api/script-image-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: getEpisode().id,
      block_id: id,
      mimeType: file.type,
      sizeBytes: file.size,
      contentHash,
    }),
  });
  const out = await res.json().catch(() => null);
  // DEDUPE HIT — the bytes already live in the bucket; the server returned the public URL and NO
  // uploadUrl. Skip the PUT entirely (zero bytes moved) and adopt the existing object.
  if (res.ok && out && out.ok && out.deduped && out.publicUrl) return { url: out.publicUrl };
  if (!res.ok || !out || !out.ok || !out.uploadUrl) {
    return { error: (out && out.error) || `http ${res.status}` };
  }
  const put = await fetch(out.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': out.mime || file.type, 'x-upsert': 'false' },
    body: file,
  });
  if (!put.ok) return { error: `storage put http ${put.status}` };
  return { url: out.publicUrl };
}

// GIF → MP4 AUTO-OPTIMIZATION. A big animated reference GIF (the real one: 78MB,
// 1304×653, 12fps) is transcoded to a looping mp4 IN THE BROWSER before upload —
// visually identical, ~10-20× smaller, decoded off the main thread. The transcoder
// chunk (gif-transcode.js + mp4-muxer) is dynamic-import()ed only when this pre-gate
// passes, so the core editor chunk never carries it. The cheap mime+size pre-gate here
// mirrors (not replaces) the module's authoritative shouldTranscodeGif — which re-checks
// mime+size AND the WebCodecs capability the transcode actually needs.
// ANY failure returns the ORIGINAL file: the gif then uploads exactly as it does today.
// onLabel(text) narrates the stage — the DROP path writes it to the decoration widget, the
// PASTE path pushes it through the media-progress event to the block's nodeview.
async function maybeTranscodeGif(file, onLabel) {
  if (String(file.type || '').toLowerCase() !== 'image/gif' || file.size <= 2 * 1024 * 1024) return file;
  try {
    const mod = await import('./gif-transcode.js');
    if (!mod.shouldTranscodeGif(file)) return file;
    onLabel?.('OPTIMIZING GIF…');
    const mp4 = await mod.transcodeGifToMp4(file);
    onLabel?.('UPLOADING VIDEO…');
    return mp4;
  } catch {
    onLabel?.(PLACEHOLDER_DEFAULT_LABEL);
    return file; // fall back to the plain-gif road — never block the drop on the optimizer
  }
}

async function uploadAndInsert(view, file, id, opts = {}) {
  let url = null;
  let detail = '';
  try {
    // The transcoded mp4 (when it happens) replaces the gif for the WHOLE road below:
    // route choice re-runs on the NEW mime+size, and the doc's src ends .mp4.
    const upload = await maybeTranscodeGif(file, (t) => setPlaceholderLabel(view, id, t));
    const out = await runMediaUpload(upload, id);
    if (out.url) url = out.url;
    else detail = out.error || '';
  } catch (e) {
    detail = e?.message || 'network error';
  }
  setPlaceholderLabel(view, id, null); // drop resolved either way — never leak a label
  if (view.isDestroyed) return;

  if (!url) {
    // LOUD failure — the doc is clean either way (placeholder is decoration-only), but
    // Johnny must know the image did not stay. Never a silent no-op.
    view.dispatch(removePlaceholderTr(view.state, id));
    toast(`image upload failed (${detail || 'unknown'}) — the picture was NOT added`);
    return;
  }
  // alt (the caption) starts EMPTY — captions are hidden until Johnny clicks below the
  // image and types one (imageBlock nodeview). The filename was never a caption he wrote.
  const tr = insertImageTr(view.state, id, { src: url, alt: '', kind: 'shot', select: !!opts.focusSelect });
  if (!tr) {
    // Placeholder deleted (row removed / undo) or position no longer legal → ABORT.
    view.dispatch(removePlaceholderTr(view.state, id));
    toast('that spot was edited away while the image uploaded — drop it again');
    return;
  }
  view.dispatch(tr);
  if (opts.focusSelect) {
    // ⌘⌃M path: the tr left a NodeSelection on the image; focus the view so PM syncs the DOM
    // selection onto the node NOW (not on the user's first click). The editor lands focused +
    // selected — the just-inserted gif is immediately clickable, no select-then-deselect flicker.
    try { view.focus(); } catch {}
  }
}

// THE CORE AT-CARET INSERT (the drop path's engine, extracted so it can be driven from a raw
// position with no DragEvent). Refine `rawPos` to the nearest LEGAL point INSIDE the cell via
// PM's dropPoint, place one decoration placeholder per file there, and kick the async uploads.
// Placeholders at the same position map to AFTER each landed insert (widget side ≥ 0), so a
// multi-file batch keeps its order. Returns true when the caret had a legal inline spot and the
// upload(s) started; false when there is NO legal point (the caller decides the fallback — the
// drop handler toasts, the ⌘⌃M hotkey drops to the new-row paste). Exported so downloads-newest.js
// lands the newest gif INLINE IN THE CELL at the live cursor, byte-identical to dragging it there.
// `opts.focusSelect` (⌘⌃M hotkey): after each upload lands, focus the view and NodeSelect the
// inserted image so it is immediately clickable in a possibly-blurred editor (see insertImageTr /
// the blocks.js FOCUS-RACE FIX). The drop handler passes NO opts — its selection behavior is
// untouched (mouse already in the doc).
export function insertMediaAtPos(view, files, rawPos, opts = {}) {
  const pos = resolveDropPos(view.state, rawPos);
  if (pos == null) return false;
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`"${file.name}" is over ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB — too big for the script rack`);
      continue;
    }
    const id = mintImageBlockId();
    view.dispatch(addPlaceholderTr(view.state, pos, id));
    uploadAndInsert(view, file, id, opts);
  }
  return true;
}

// Shared DROP entry: insert at the refined position, and on NO legal spot give the drop's calm
// "aim at a row" toast (the hotkey uses insertMediaAtPos directly so it can fall back instead).
function startUploads(view, files, rawPos) {
  if (!insertMediaAtPos(view, files, rawPos)) {
    toast('no legal spot for an image there — try dropping onto a row');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// CLIPBOARD PASTE → NEW ROW (2026-07-21). Johnny: "copy images gifs/videos and paste them and
// have them properly copy into new rows." Unlike the DROP path above (which drops a still INTO
// the cell it lands on, via a decoration placeholder), a PASTE inserts each media item as its
// own FULL-WIDTH ROW at the caret — the same tableRow(cols:1) > tableCell(role:'full') > block
// shape /chapter builds (doInsertStructureBlock). Multiple items paste as consecutive rows in
// clipboard order.
//
// PLACEHOLDER MODEL — ATTR-DRIVEN (WP-13), deliberately NOT the decoration model the drop path
// uses. The row lands IMMEDIATELY as a real imageBlock with `uploading:true` + empty src, and the
// upload promise swaps in the final src (or an uploadError) via setNodeMarkup. Both the insert and
// the swap are ordinary user-initiated transactions — collaborators watch the uploading row appear
// then resolve, it survives reload (an interrupted upload renders a recoverable error card), and
// there is NO appendTransaction (COLLAB LOOP LAW). The block is found by its stable blockId at
// swap time, so a concurrent edit that moved it is handled and one a collaborator DELETED simply
// aborts the swap (nothing to write into) — never a clamp to a wrong position.

// Session upload registry — lives only for this tab's lifetime. `activeUploads` = ids whose bytes
// this session is still pushing (drives the spinner vs. interrupted-after-reload fork in the
// nodeview). `pendingFiles` keeps the original File so RETRY can re-upload without re-pasting.
// `progressLabels` is the transcode/upload stage text, surfaced to the nodeview via an event.
const activeUploads = new Set();
const pendingFiles = new Map();
const progressLabels = new Map();
export const MEDIA_PROGRESS_EVENT = 'wp-media-progress';

export function mediaUploadIsActive(id) { return activeUploads.has(id); }
export function mediaUploadCanRetry(id) { return pendingFiles.has(id); }
export function mediaUploadLabel(id) { return progressLabels.get(id) || ''; }

function setMediaProgress(id, label) {
  if (label == null) progressLabels.delete(id);
  else progressLabels.set(id, label);
  try { window.dispatchEvent(new CustomEvent(MEDIA_PROGRESS_EVENT, { detail: { id, label: label ?? '' } })); } catch {}
}

// A compact, human error for the block's error card (the raw detail can be a long http string).
function shortMediaError(detail) {
  const d = String(detail || '').trim();
  if (!d) return 'upload failed';
  return d.length > 80 ? d.slice(0, 77) + '…' : d;
}

// Which node types the media upload machinery (placeholder swap / retry / remove) drives. Both
// carry the same uploading/uploadError/src placeholder-attr contract, so one blockId lookup serves
// image and audio alike (blockIds are globally unique, so there is no cross-type collision).
const MEDIA_NODE_TYPES = new Set(['imageBlock', 'audioBlock']);

// Find the doc position of the image/audio block carrying this blockId (null = gone). Identity, never
// a raw position — so a swap survives concurrent edits that shifted the block.
export function findImageBlockPos(state, id) {
  let at = null;
  state.doc.descendants((node, pos) => {
    if (at != null) return false;
    if (MEDIA_NODE_TYPES.has(node.type.name) && node.attrs.blockId === id) { at = pos; return false; }
    return undefined;
  });
  return at;
}

// Build a full-width media row: tableRow(cols:1, pairu_) > tableCell(role:'full') > imageBlock.
// The pairu_ pairId marks it user-added (document-builder's Palau culler keeps it while the
// upload is still resolving and the block has no words). Returns null if the schema lacks a
// piece (bare pre-table doc) — the caller falls back to a top-level block insert.
export function buildMediaRowNode(schema, { id, alt = '', kind = 'shot' }) {
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const imgType = schema.nodes.imageBlock;
  if (!rowType || !cellType || !imgType) return null;
  const img = imgType.create({ blockId: id, src: '', alt, kind, uploading: true, uploadError: null });
  return rowType.create({ cols: 1, pairId: mintUserPairId() }, cellType.create({ role: 'full' }, img));
}

// Insert one placeholder row per item, AFTER the caret's OUTERMOST tableRow (top-level structure,
// exactly like doInsertStructureBlock) — consecutive rows preserve clipboard order. ONE
// transaction so a single undo removes the whole paste. Returns true on success.
export function insertPlaceholderRows(view, items) {
  const { state } = view;
  const schema = state.schema;
  const $pos = state.selection.$from;
  let rowDepth = 0;
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'tableRow') { rowDepth = d; break; }
  }
  const tr = state.tr;
  if (rowDepth > 0) {
    let insertAt = $pos.after(rowDepth);
    for (const it of items) {
      const row = buildMediaRowNode(schema, it);
      if (!row) return false;
      tr.insert(insertAt, row);
      insertAt += row.nodeSize;
    }
  } else {
    // Bare (pre-table) doc — no row spine yet. Insert the imageBlocks at the top level; the
    // load-time ensureTableDoc wrap turns them into rows exactly like any other bare block.
    const imgType = schema.nodes.imageBlock;
    if (!imgType) return false;
    let insertAt = $pos.depth > 0 ? $pos.after(1) : Math.min($pos.pos, state.doc.content.size);
    for (const it of items) {
      const img = imgType.create({ blockId: it.id, src: '', alt: it.alt || '', kind: it.kind || 'shot', uploading: true, uploadError: null });
      tr.insert(insertAt, img);
      insertAt += img.nodeSize;
    }
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

// Swap the imageBlock's attrs by blockId (setNodeMarkup). false = the block is gone (deleted
// locally or by a collaborator) → the caller aborts, never clamps.
export function swapMediaBlock(view, id, patch) {
  const pos = findImageBlockPos(view.state, id);
  if (pos == null) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !MEDIA_NODE_TYPES.has(node.type.name)) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
  return true;
}

// Upload the bytes, then RESOLVE the placeholder block: swap in the final src, or mark it errored.
// The swap is the resolution of the user's paste — dispatching it from the promise is fine (not a
// loop). Failure keeps the File in pendingFiles so the block's RETRY button can re-upload.
async function uploadAndSwap(view, file, id) {
  let url = null;
  let detail = '';
  try {
    const upload = await maybeTranscodeGif(file, (t) => setMediaProgress(id, t));
    const out = await runMediaUpload(upload, id);
    if (out.url) url = out.url;
    else detail = out.error || '';
  } catch (e) {
    detail = e?.message || 'network error';
  }
  activeUploads.delete(id);
  setMediaProgress(id, null);
  if (view.isDestroyed) { pendingFiles.delete(id); return; }

  if (!url) {
    // LOUD, RECOVERABLE failure — the row stays with an error card (retry keeps the bytes). Never
    // a silent vanish. If the block was deleted meanwhile, there is nothing to mark — drop it.
    swapMediaBlock(view, id, { uploading: false, uploadError: shortMediaError(detail) });
    return;
  }
  pendingFiles.delete(id);
  if (!swapMediaBlock(view, id, { uploading: false, uploadError: null, src: url })) {
    // The row was removed before the upload landed (undo, or a collaborator). Bytes are orphaned
    // in the bucket (no doc state) — acceptable. Tell Johnny so a vanished paste isn't a mystery.
    toast('the pasted media’s row was removed before its upload finished');
  }
}

// PASTE entry: one placeholder row per media file, in clipboard order, then kick the uploads.
// Exported so the DOWNLOADS HOTKEY (downloads-newest.js) can reuse the EXACT paste insert path —
// a file grabbed from ~/Downloads lands as a new row identically to a clipboard paste, inheriting
// the transcode / route-split / dedupe / 413-self-heal / video-loop pipeline verbatim.
export function startMediaPaste(view, files) {
  const items = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`"${file.name}" is over ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB — too big for the script rack`);
      continue;
    }
    items.push({ id: mintImageBlockId(), alt: '', kind: 'shot', file });
  }
  if (!items.length) return;
  // Register active BEFORE the insert so the freshly-mounted nodeview shows the spinner (not the
  // interrupted-after-reload card). pendingFiles holds the bytes for a possible retry.
  for (const it of items) { activeUploads.add(it.id); pendingFiles.set(it.id, it.file); setMediaProgress(it.id, PLACEHOLDER_DEFAULT_LABEL); }
  const ok = insertPlaceholderRows(view, items.map(({ id, alt, kind }) => ({ id, alt, kind })));
  if (!ok) {
    for (const it of items) { activeUploads.delete(it.id); pendingFiles.delete(it.id); setMediaProgress(it.id, null); }
    toast('could not place the pasted media — click into a row first, then paste');
    return;
  }
  for (const it of items) uploadAndSwap(view, it.file, it.id);
}

// RETRY (from the block's error card) — re-upload the kept bytes. No bytes (post-reload) → no-op;
// the card then offers only REMOVE.
export function retryMediaUpload(view, id) {
  if (isReadOnly() || !view.editable) return;
  const file = pendingFiles.get(id);
  if (!file) return;
  // Route the retry to the SAME pipeline the block's type uses — an audioBlock must re-run the
  // convert+upload path (uploadAndSwapAudio), never the image path (which skips the mp3 transcode).
  const pos = findImageBlockPos(view.state, id);
  const isAudio = pos != null && view.state.doc.nodeAt(pos)?.type.name === 'audioBlock';
  if (!swapMediaBlock(view, id, { uploading: true, uploadError: null, src: '' })) { pendingFiles.delete(id); return; }
  activeUploads.add(id);
  setMediaProgress(id, isAudio ? PLACEHOLDER_DEFAULT_AUDIO_LABEL : PLACEHOLDER_DEFAULT_LABEL);
  if (isAudio) uploadAndSwapAudio(view, file, id);
  else uploadAndSwap(view, file, id);
}

// REMOVE (from the block's error card) — delete the interrupted/failed block. When it is the lone
// block in its full-width row, delete the whole row (a tableCell is block+ and cannot sit empty).
export function removeMediaBlock(view, id) {
  if (isReadOnly() || !view.editable) return;
  const { state } = view;
  const pos = findImageBlockPos(state, id);
  activeUploads.delete(id); pendingFiles.delete(id); setMediaProgress(id, null);
  if (pos == null) return;
  const node = state.doc.nodeAt(pos);
  if (!node) return;
  const $pos = state.doc.resolve(pos);
  const cell = $pos.parent;                    // the tableCell holding the imageBlock
  const row = $pos.depth >= 1 ? $pos.node($pos.depth - 1) : null;
  let from = pos;
  let to = pos + node.nodeSize;
  if (cell?.type.name === 'tableCell' && cell.childCount === 1 &&
      row?.type.name === 'tableRow' && row.childCount === 1 && state.doc.childCount > 1) {
    from = $pos.before($pos.depth - 1);
    to = from + row.nodeSize;
  }
  view.dispatch(state.tr.delete(from, to));
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// AUDIO — drop / paste an audio file (wav / mp3 / m4a / .qta) → an audioBlock waveform strip.
// Same attr-driven placeholder model as the media PASTE path: the block lands IMMEDIATELY with
// uploading:true, then the async convert(if needed)+upload swaps in the final mp3/wav src by
// blockId (setNodeMarkup). One insert transaction, no appendTransaction (COLLAB LOOP LAW),
// survives reload (interrupted → recoverable card), inherits the signed-road + dedupe + 413-heal
// pipeline. DROP lands the strip AT THE CURSOR IN-CELL (like insertMediaAtPos); PASTE lands it as
// its own full-width row (like startMediaPaste).

const PLACEHOLDER_DEFAULT_AUDIO_LABEL = 'PREPARING AUDIO…';

// Ensure a passthrough (wav/mp3) file carries a CANONICAL audio mime so the signed endpoint stores
// the right Content-Type + extension — a Finder wav can arrive with an empty or non-canonical type,
// which the server would otherwise coerce to png. Never re-encodes; just re-labels the wrapper.
function normalizeAudioPassthrough(file) {
  const name = String(file.name || 'audio');
  const type = String(file.type || '').toLowerCase();
  const isMp3 = /\.mp3$/i.test(name) || type === 'audio/mpeg' || type === 'audio/mp3';
  const targetType = isMp3 ? 'audio/mpeg' : 'audio/wav';
  if (type === targetType) return file;
  try { return new File([file], name, { type: targetType }); } catch { return file; }
}

// Best-effort clip duration for the strip (persisted only when known). Reads metadata off a throwaway
// <audio> element; a format the browser can't even preview resolves null (the nodeview reads it live
// off WaveSurfer instead). Never throws; times out at 4s. Browser-only (no-op path is fine headless).
function audioDurationSafe(file) {
  return new Promise((resolve) => {
    try {
      if (typeof Audio !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return resolve(null);
      const url = URL.createObjectURL(file);
      const a = new Audio();
      let done = false;
      const finish = (d) => { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch {} resolve(Number.isFinite(d) && d > 0 ? d : null); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => finish(a.duration);
      a.onerror = () => finish(null);
      a.src = url;
      setTimeout(() => finish(null), 4000);
    } catch { resolve(null); }
  });
}

// Convert a dropped audio file to an UPLOADABLE web-playable file: wav/mp3 pass through unchanged
// (just re-labeled canonical); everything else is transcoded to mp3 (audio-transcode.js — decodeAudioData
// → lamejs, ffmpeg.wasm fallback). Transcode failure THROWS so the caller marks the block uploadError —
// NEVER a silent drop. onLabel narrates the stage into the block's status card.
async function maybeTranscodeAudio(file, onLabel) {
  if (audioTranscodeDecision(file) === 'passthrough') {
    onLabel?.('UPLOADING AUDIO…');
    return normalizeAudioPassthrough(file);
  }
  onLabel?.('CONVERTING TO MP3…');
  const mod = await import('./audio-transcode.js');
  // The encode yields the main thread mid-loop and ticks progress, so narrate a live percent into the
  // status card (0..1 → "CONVERTING TO MP3… 42%"). Proof the tab is alive, not the frozen 4s burst.
  const mp3 = await mod.transcodeToMp3(file, {
    onProgress: (p) => {
      if (typeof p === 'number' && p > 0) onLabel?.(`CONVERTING TO MP3… ${Math.min(100, Math.round(p * 100))}%`);
    },
  });
  onLabel?.('UPLOADING AUDIO…');
  return mp3;
}

// Upload the (converted) audio, then RESOLVE the placeholder block: swap in the final src + mime +
// duration, or mark it errored (retry keeps the original bytes). Same shape as uploadAndSwap.
async function uploadAndSwapAudio(view, file, id) {
  let url = null, detail = '', durationSec = null, mime = '';
  try {
    const upload = await maybeTranscodeAudio(file, (t) => setMediaProgress(id, t));
    mime = upload.type || 'audio/mpeg';
    durationSec = (typeof upload.__durationSec === 'number' && upload.__durationSec > 0)
      ? upload.__durationSec
      : await audioDurationSafe(upload);
    const out = await runMediaUpload(upload, id);
    if (out.url) url = out.url; else detail = out.error || '';
  } catch (e) {
    detail = e?.message || 'could not process audio';
  }
  activeUploads.delete(id);
  setMediaProgress(id, null);
  if (view.isDestroyed) { pendingFiles.delete(id); return; }
  if (!url) {
    swapMediaBlock(view, id, { uploading: false, uploadError: shortMediaError(detail) });
    return;
  }
  pendingFiles.delete(id);
  const patch = { uploading: false, uploadError: null, src: url, mime };
  if (durationSec != null) patch.durationSec = durationSec;
  if (!swapMediaBlock(view, id, patch)) {
    toast('the audio’s row was removed before its upload finished');
  }
}

// Refine a raw drop coordinate to a LEGAL audioBlock insertion point (PM dropPoint with an audioBlock
// probe — lands INSIDE a tableCell, block+). null = no legal point → caller aborts. Mirrors resolveDropPos.
export function resolveAudioDropPos(state, rawPos) {
  const type = state.schema.nodes.audioBlock;
  if (!type) return null;
  const probe = new Slice(Fragment.from(type.create()), 0, 0);
  return dropPoint(state.doc, rawPos, probe);
}

// DROP entry — insert one audioBlock per file AT THE CURSOR IN-CELL (refined via dropPoint), then kick
// the convert+upload. ONE transaction for the whole drop; the first block is NodeSelected + the view is
// focused so it is immediately clickable (mirrors the imageBlock post-insert focus). Returns true when
// the caret had a legal in-cell spot; false when there is none (caller toasts). Exported so a future
// downloads-hotkey can land an audio file identically.
export function insertAudioAtCursor(view, files, rawPos) {
  const pos = resolveAudioDropPos(view.state, rawPos);
  if (pos == null) return false;
  const type = view.state.schema.nodes.audioBlock;
  if (!type) return false;
  const items = [];
  for (const file of files) {
    const oversize = audioOversizeToast(file);
    if (oversize) { toast(oversize); continue; }
    items.push({ id: mintAudioBlockId(), file });
  }
  if (!items.length) return true; // oversize-only: toasted, nothing to insert (a legal spot existed)
  // Register active BEFORE the insert so the mounting nodeview shows the converting spinner (not the
  // interrupted-after-reload card). pendingFiles holds the bytes for a possible retry.
  for (const it of items) { activeUploads.add(it.id); pendingFiles.set(it.id, it.file); setMediaProgress(it.id, PLACEHOLDER_DEFAULT_AUDIO_LABEL); }
  const tr = view.state.tr;
  let insertAt = pos;
  for (const it of items) {
    const node = type.create({ blockId: it.id, src: '', origName: String(it.file.name || ''), mime: '', uploading: true, uploadError: null });
    tr.insert(insertAt, node);
    insertAt += node.nodeSize;
  }
  try { tr.setSelection(NodeSelection.create(tr.doc, pos)); } catch {}
  view.dispatch(tr.scrollIntoView());
  try { view.focus(); } catch {}
  for (const it of items) uploadAndSwapAudio(view, it.file, it.id);
  return true;
}

// PASTE — build a full-width audio row: tableRow(cols:1, pairu_) > tableCell(role:'full') > audioBlock.
// Returns null if the schema lacks a piece (bare pre-table doc) — caller falls back to a top-level insert.
export function buildAudioRowNode(schema, { id, origName = '' }) {
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const audType = schema.nodes.audioBlock;
  if (!rowType || !cellType || !audType) return null;
  const aud = audType.create({ blockId: id, src: '', origName, mime: '', uploading: true, uploadError: null });
  return rowType.create({ cols: 1, pairId: mintUserPairId() }, cellType.create({ role: 'full' }, aud));
}

// Insert one audio placeholder row per item, AFTER the caret's outermost tableRow (mirrors
// insertPlaceholderRows). ONE transaction. Returns true on success.
function insertAudioPlaceholderRows(view, items) {
  const { state } = view;
  const schema = state.schema;
  const $pos = state.selection.$from;
  let rowDepth = 0;
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'tableRow') { rowDepth = d; break; }
  }
  const tr = state.tr;
  if (rowDepth > 0) {
    let insertAt = $pos.after(rowDepth);
    for (const it of items) {
      const row = buildAudioRowNode(schema, it);
      if (!row) return false;
      tr.insert(insertAt, row);
      insertAt += row.nodeSize;
    }
  } else {
    const audType = schema.nodes.audioBlock;
    if (!audType) return false;
    let insertAt = $pos.depth > 0 ? $pos.after(1) : Math.min($pos.pos, state.doc.content.size);
    for (const it of items) {
      const aud = audType.create({ blockId: it.id, src: '', origName: it.origName || '', mime: '', uploading: true, uploadError: null });
      tr.insert(insertAt, aud);
      insertAt += aud.nodeSize;
    }
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

// PASTE entry — one audio row per file, in clipboard order, then kick the convert+uploads.
export function startAudioPaste(view, files) {
  const items = [];
  for (const file of files) {
    const oversize = audioOversizeToast(file);
    if (oversize) { toast(oversize); continue; }
    items.push({ id: mintAudioBlockId(), origName: String(file.name || ''), file });
  }
  if (!items.length) return;
  for (const it of items) { activeUploads.add(it.id); pendingFiles.set(it.id, it.file); setMediaProgress(it.id, PLACEHOLDER_DEFAULT_AUDIO_LABEL); }
  const ok = insertAudioPlaceholderRows(view, items.map(({ id, origName }) => ({ id, origName })));
  if (!ok) {
    for (const it of items) { activeUploads.delete(it.id); pendingFiles.delete(it.id); setMediaProgress(it.id, null); }
    toast('could not place the pasted audio — click into a row first, then paste');
    return;
  }
  for (const it of items) uploadAndSwapAudio(view, it.file, it.id);
}

// Collect media files from a paste event — files first (a real image/video copy populates
// clipboardData.files), then file-kind items as a fallback (some browsers only populate items for
// a copied image). A plain-text / HTML / ProseMirror-slice paste carries NO file here, so this
// returns [] and the paste falls through untouched (the writing-tool paste path is sacred).
function rawClipboardFiles(event) {
  const dt = event.clipboardData;
  if (!dt) return [];
  const out = [];
  const seen = new Set();
  const push = (f) => {
    if (!f) return;
    const key = `${f.name}|${f.size}|${f.type}`;
    if (seen.has(key)) return;
    seen.add(key); out.push(f);
  };
  if (dt.files && dt.files.length) for (const f of dt.files) push(f);
  if (dt.items && dt.items.length) for (const it of dt.items) { if (it.kind === 'file') push(it.getAsFile()); }
  return out;
}
function mediaFilesFromClipboard(event) {
  const { media } = pickMediaFiles(rawClipboardFiles(event));
  return media;
}
// AUDIO from the clipboard (extension-first, so a copied .qta routes to audio not video).
function audioFilesFromClipboard(event) {
  return rawClipboardFiles(event).filter(isAudioFile);
}

// Exported so the test mounts the EXACT production plugin on a bare EditorState.
export function buildImageDropPlugin() {
  return new Plugin({
    key: imageDropKey,
    state: {
      init() { return { set: DecorationSet.empty, anchors: new Map() }; },
      apply(tr, value, oldState, newState) {
        let { set, anchors } = value;
        const hasAnchors = collabAnchors && anchors.size > 0;
        if (hasAnchors && collabAnchors.isRemote(tr)) {
          // Y-SYNC APPLY — a full-doc replace; numeric mapping would drop every widget.
          // Rebuild each placeholder from its Yjs relative anchor. An anchor that no
          // longer resolves means its site was truly deleted remotely → the placeholder
          // drops out and the in-flight insert aborts (same contract as local deletion).
          let rebuilt = DecorationSet.empty;
          const survivors = new Map();
          for (const [id, anchor] of anchors) {
            const abs = collabAnchors.toAbs(newState, anchor);
            if (abs == null) continue;
            rebuilt = rebuilt.add(tr.doc, [Decoration.widget(abs, () => placeholderDom(id), { id })]);
            survivors.set(id, anchor);
          }
          set = rebuilt;
          anchors = survivors;
        } else {
          // Map every live placeholder through this transaction FIRST (positions survive
          // concurrent local edits; a placeholder whose position is deleted drops out of the
          // set — that disappearance is exactly what makes the insert abort), THEN apply
          // add/remove meta against the mapped set.
          set = set.map(tr.mapping, tr.doc);
          if (anchors.size) {
            // Prune anchors whose widgets a LOCAL edit deleted — otherwise the next y-sync
            // rebuild would resurrect a placeholder the user already edited away.
            const alive = new Set(set.find().map((d) => d.spec.id));
            if (alive.size !== anchors.size) {
              anchors = new Map([...anchors].filter(([id]) => alive.has(id)));
            }
          }
        }
        const meta = tr.getMeta(imageDropKey);
        if (meta?.add) {
          const deco = Decoration.widget(meta.add.pos, () => placeholderDom(meta.add.id), { id: meta.add.id });
          set = set.add(tr.doc, [deco]);
          if (collabAnchors) {
            const anchor = collabAnchors.toRel(newState, meta.add.pos);
            if (anchor != null) anchors = new Map(anchors).set(meta.add.id, anchor);
          }
        }
        if (meta?.remove) {
          set = set.remove(set.find(undefined, undefined, (spec) => spec.id === meta.remove.id));
          if (anchors.has(meta.remove.id)) {
            anchors = new Map(anchors);
            anchors.delete(meta.remove.id);
          }
        }
        return { set, anchors };
      },
    },
    props: {
      decorations(state) { return imageDropKey.getState(state)?.set; },
      // handleDOMEvents.drop (not props.handleDrop) is deliberate: PM only calls
      // handleDrop AFTER posAtCoords resolves — if it doesn't, an unhandled file drop
      // still NAVIGATES THE TAB. This DOM-level hook fires first and swallows EVERY
      // file drop over the editor unconditionally. Non-file drops (PM node drags, the
      // table.js row-reorder — which also stopPropagates on the row DOM before reaching
      // us) carry no dataTransfer.files, return false, and proceed untouched.
      handleDOMEvents: {
        drop(view, event) {
          const files = event.dataTransfer && event.dataTransfer.files;
          if (!files || !files.length) {
            // NO FILES — a TEXT drag (selected transcript text). If it matches the transcript shape
            // AND the feature is on, land it as a quote row; otherwise leave PM's default text drop
            // untouched (return false). The writing-tool drop path stays sacred.
            if (episodeFlag('transcriptDrop') && !isReadOnly() && view.editable) {
              const txt = event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
              const parsed = txt && parseTranscriptText(txt);
              if (parsed) {
                const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (at) { event.preventDefault(); insertQuoteRow(view, parsed, at.pos); return true; }
              }
            }
            return false;
          }
          event.preventDefault(); // NEVER navigate away on a file drop, whatever the file
          if (isReadOnly() || !view.editable) return true; // read-only: swallow silently
          // AUDIO comes off FIRST (extension-based, so a .qta reporting video/quicktime routes to the
          // audio waveform strip, not a broken <video>). Images/videos take the untouched path below.
          const allDropped = Array.from(files);
          const audioDropped = allDropped.filter(isAudioFile);
          const restDropped = allDropped.filter((f) => !isAudioFile(f));
          const { media, rejected } = pickMediaFiles(restDropped);
          if (!media.length && !audioDropped.length) {
            toast('only png / jpeg / webp / gif images, mp4 / webm / mov videos, or wav / mp3 / m4a audio can be dropped into the script');
            return true;
          }
          if (rejected.length) {
            toast(`${rejected.length} file${rejected.length > 1 ? 's' : ''} skipped — only images, videos, or audio land here`);
          }
          const raw = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!raw) {
            toast('could not find a spot for that — drop it onto a row');
            return true;
          }
          // AUDIO → a waveform strip AT THE CURSOR IN-CELL (insertAudioAtCursor: transcode weird
          // formats → mp3, signed-road upload, dedupe/413-heal, post-insert focus).
          if (audioDropped.length && !insertAudioAtCursor(view, audioDropped, raw.pos)) {
            toast('no legal spot for audio there — try dropping onto a row');
          }
          if (!media.length) return true;
          // TRANSCRIPT DROP disambiguation — an image could be a still (MEDIA) or a screenshot of a
          // transcript (QUOTE). Offer the flat choice at the drop point; MEDIA runs the untouched
          // path below, QUOTE reads the first image with the vision endpoint and falls back to media
          // on failure. Only a single-image drop is ambiguous; a video or a multi-file drop is media.
          const firstIsImage = SUPPORTED_IMAGE_MIMES.has(String(media[0]?.type || '').toLowerCase());
          if (episodeFlag('transcriptDrop') && media.length === 1 && firstIsImage) {
            const shown = offerMediaOrQuote(view, {
              coords: { x: event.clientX, y: event.clientY },
              onMedia: () => startUploads(view, media, raw.pos),
              onQuote: () => startImageQuote(view, media[0], raw.pos, () => startUploads(view, media, raw.pos)),
            });
            if (shown) return true;
          }
          startUploads(view, media, raw.pos);
          return true;
        },
      },
      // PASTE MEDIA → NEW ROWS. Pasted images / gifs / videos each land as their own full-width
      // row at the caret (startMediaPaste). A paste with NO media file — plain text, HTML, a
      // ProseMirror slice — returns false and falls through to PasteSanitize / PM UNTOUCHED. This
      // passthrough is sacred in a writing tool, so the guard is: only hijack when
      // mediaFilesFromClipboard actually found a supported image/video file.
      handlePaste(view, event) {
        const media = mediaFilesFromClipboard(event);
        const audio = audioFilesFromClipboard(event);
        if (!media.length && !audio.length) {
          // NOT a media paste. Before falling through to the sacred writing paste path, check whether
          // the plain-text clipboard IS a transcript soundbite (pure regex, instant). Only when it
          // matches AND the feature is on do we hijack — a normal paste is byte-untouched.
          if (episodeFlag('transcriptDrop') && !isReadOnly() && view.editable) {
            const txt = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
            const parsed = txt && parseTranscriptText(txt);
            if (parsed) { event.preventDefault(); insertQuoteRow(view, parsed, view.state.selection.from); return true; }
          }
          return false; // not a media/transcript paste — normal paste proceeds untouched
        }
        if (isReadOnly() || !view.editable) return true; // read-only share: swallow, never mutate
        event.preventDefault();
        // AUDIO pastes land as their own full-width waveform rows (transcode weird formats → mp3).
        if (audio.length) startAudioPaste(view, audio);
        if (!media.length) return true;
        // TRANSCRIPT DROP disambiguation on a single-image paste — MEDIA (the untouched new-row paste)
        // or QUOTE (read it as a transcript). A video / multi-file paste is unambiguously media.
        const firstIsImage = SUPPORTED_IMAGE_MIMES.has(String(media[0]?.type || '').toLowerCase());
        if (episodeFlag('transcriptDrop') && media.length === 1 && firstIsImage) {
          const caret = view.coordsAtPos(view.state.selection.from);
          const shown = offerMediaOrQuote(view, {
            coords: { x: caret.left, y: caret.bottom },
            onMedia: () => startMediaPaste(view, media),
            onQuote: () => startImageQuote(view, media[0], view.state.selection.from, () => startMediaPaste(view, media)),
          });
          if (shown) return true;
        }
        startMediaPaste(view, media);
        return true;
      },
    },
  });
}

export const ImageDrop = Extension.create({
  name: 'burmaImageDrop',
  addProseMirrorPlugins() {
    return [buildImageDropPlugin()];
  },
});
