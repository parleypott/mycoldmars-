// Burma Script Tool — document builder.
// Maps the parsed 225 blocks (window.__BLOCKS__ shape, see burma-script/schema.ts)
// into a TipTap/ProseMirror JSON document. MIRRORS translation/src/editor/document-builder.js:
// pure function, blocks -> { type:'doc', content:[...] }, every node carries the attrs it
// needs to round-trip back into a block. Edits + reorders mutate the TipTap doc; we read
// the doc back out to a blocks array for persistence (docToBlocks).
//
// DESIGN LAW: ONE uniform rhythm. Block type differentiated by NODE name + subtle structure,
// never by loud containers. Chapter/scene = quiet headings. VO/ONCAM = editable prose.
// SOT/B-roll = a tight row where the TIMECODE is the hero. Genre = faint gutter metadata only.

// ---- text hygiene -------------------------------------------------------
// DATA-INTEGRITY LAW (WP-01 integrity fix): KEEP EVERY WORD. The old pipeline
// deleted leading timecodes, "SOT:"/"DAY n" labels, beat markers, bullets, and
// unterminated chip openers — and never restored them, so they vanished from the
// doc (docToBlocks reads the stripped node). That dropped 57 timecodes + 104 lines.
//
// The ONLY transforms allowed now: unescape markdown backslashes + collapse runs of
// whitespace. Nothing is deleted. The text is the source of truth — every word the
// parser handed us must reach the page (and round-trip back out).
// Crop shape guard for the blocks<->node conversion. Kept in lockstep with blocks.js isValidCrop
// (asserted by image-resize-crop.test.mjs) but inlined so document-builder pulls in no TipTap deps.
function imageCropShapeOk(c) {
  if (!c || typeof c !== 'object') return false;
  const { x, y, w, h } = c;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (![x, y, w, h].every(num)) return false;
  if (w <= 0 || h <= 0 || x < 0 || y < 0) return false;
  if (x + w > 1.0001 || y + h > 1.0001) return false;
  return !(x <= 0.0001 && y <= 0.0001 && w >= 0.9999 && h >= 0.9999);
}

function clean(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\([\-\[\]\!\(\)\.\*_`#>~])/g, '$1') // unescape markdown escapes
    .replace(/⁠/g, '')                          // word-joiner noise (zero-width, no content)
    .replace(/[ \t]+\n/g, '\n')                    // trailing space before a hard break
    .replace(/[ \t]{2,}/g, ' ')                    // collapse runs of spaces — no words lost
    .trim();
}

// Light read-tidy ONLY: unescape + collapse whitespace. KEEPS every word, every
// label, every timecode (they become clickable chips downstream via inlineContent).
// No deletion — this is the integrity-safe replacement for the old strip functions.
function stripLead(text /*, type */) {
  return clean(text);
}

// SOT/broll body prose. The HERO timecode lives in attrs (the LCD), but the body may
// ALSO carry labels ("DAY 1 SOT:"), bullets, AND additional embedded timecodes — all of
// which we KEEP. Extra timecodes become stacked chips (inlineContent tags them); the
// labels are real authoring context. Integrity-safe: unescape + collapse only.
export function cleanQuote(text) {
  return clean(text);
}

export function stripPalauSotSpeaker(text, speaker) {
  const source = text ?? '';
  const label = speaker ?? '';

  if (!source || !label) {
    return source;
  }

  const at = source.indexOf(label);

  if (at === -1) {
    return source;
  }

  const eatSpace = source.charAt(at + label.length) === ' ' ? 1 : 0;
  return source.slice(0, at) + source.slice(at + label.length + eatSpace);
}

// Worklists are READ-ONLY handoff views — no round-trip back to blocks — so we can safely
// unwrap the inline span scaffolding for display. nodeText/wrapToken re-wrap the marked
// spans into literal '{tk …}' / '[visual …]' tokens so the live doc round-trips; but a
// producer reading a checklist shouldn't see that markup. Strip the braces/brackets and
// keep the inner text. This is the INVERSE of inlineContent/wrapToken above — keep the two
// in sync (guarded by the worklist-unwrap checks in integrity-check.ts).
import { getEpisode, episodeFlag } from './episode-config.js';
import { directionChipText } from './extensions/direction-chip.js';

export function stripSpanScaffolding(text) {
  if (!text) return '';
  return String(text)
    .replace(/\{\s*(?:tk|fc|fact)\b[:\s]*([^{}]*)\}/gi, '$1') // {tk unique feature}/{fc claim} -> inner
    .replace(/\[([^\[\]]*)\]/g, '$1')             // [highlights India] -> highlights India
    // The parser sometimes leaves an UNTERMINATED span — '{tk note that runs to EOL' with no
    // closing brace, or a stray '[' with no ']'. Peel the bare scaffolding chars too so no
    // raw markup leaks into the handoff view.
    .replace(/\{\s*tk\b[:\s]*/gi, '')             // unterminated '{tk …'
    .replace(/[{}\[\]]/g, '')                     // any stray lone brace/bracket
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ---- chapter / scene heading clause --------------------------------------
// THE CHAPTER-TITLE BUG (DESIGN LAW v3): a chapter must show the HEADING CLAUSE ONLY —
// never its whole paragraph rendered at 38px. The parser sometimes hands a chapter a long
// run of prose as its "title". Clamp to the first clause: cut at the first hard line break,
// then at the first sentence-ending punctuation, then hard-cap the length on a word boundary
// so a giant title can never blow out the big-type heading. The full text still round-trips
// out of the live doc (docToBlocks reads node text), so nothing is lost on export.
function headingClause(text, cap) {
  let t = clean(text);
  if (!t) return '';
  // first line wins (parser often packs the heading on line 1, body after a break)
  const nl = t.search(/[\r\n]/);
  if (nl > 0) t = t.slice(0, nl).trim();
  // then the first sentence clause, but only if there's a long tail after it
  const sent = t.match(/^(.{8,}?[.!?:;])\s+\S/);
  if (sent && t.length > cap) t = sent[1].trim();
  // hard cap on a word boundary as the final guard
  if (t.length > cap) {
    const cut = t.slice(0, cap);
    const sp = cut.lastIndexOf(' ');
    t = (sp > cap * 0.6 ? cut.slice(0, sp) : cut).trim().replace(/[\s,;:–—-]+$/, '') + '…';
  }
  return t;
}

// ---- timecode formatting -------------------------------------------------
// The HERO element on SOT/broll. Keep the full broadcast timecode HH:MM:SS:FF
// (frame-accurate — editors live by it). Just normalise spacing.
function formatTimecode(tc) {
  if (!tc) return '';
  // Zero-padded HH:MM:SS:FF (canonical broadcast form, matching TIMECODE_RE / parser.ts's TC).
  const m = String(tc).trim().match(/(\d{2}:\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : String(tc).trim();
}

// ---- inline span splitting ----------------------------------------------
// VO/ONCAM prose carries inline {TK research} and [visual] direction. We split the
// text into TipTap text nodes, marking the spans so the editor can render the Swiss-red
// underline workshop affordance. Works off literal {…}/[…] in the cleaned text so it
// survives editing (the schema offsets would drift once the user types).
// Any broadcast timecode anywhere in the prose: zero-padded HH:MM:SS:FF — INCLUDING when glued to a
// letter/@/bracket/punct with NO leading space ("ON CAM02:17:09:07", "03:49:59:08@").
// TRULY MIRRORS parser.ts's TC (snapshot-key-collision sibling fix, timecode-hour-divergence): the
// hour is EXACTLY two digits (\d{2}), same as parser.ts's TC/TC_HAS — broadcast timecodes are
// conventionally zero-padded. A non-\b detector with a lookbehind rejecting a longer numeric run
// ("102:02:01:070") or a "digit:" sub-field, and a lookahead rejecting a 5th ":FF" field — so a
// label-colon ("ALT:03:19:40:07") and a trailing "tc: description" colon are kept. The hour pattern
// (TC_HOUR) is shared with marks.js's input/paste rules so the three sites can't silently drift:
// previously the builder/marks accepted a single-digit hour the parser rejected, so "2:02:01:07"
// chipped here but never routed as a SOT — a string that was a timecode in one half of the system
// and invisible in the other. \d{2} everywhere closes that divergence.
const TIMECODE_RE = /(?<!\d)(?<!\d:)\d{2}:\d{2}:\d{2}:\d{2}(?!:?\d)/;
const TIMECODE_RE_G = /(?<!\d)(?<!\d:)\d{2}:\d{2}:\d{2}:\d{2}(?!:?\d)/g;
// Palau interview bodies preserve bracketed IN/OUT prose as HH:MM:SS (plus a separate [4.8]
// duration token). Keep Burma's broadcast-only detector frozen above, then add a Palau-only
// three-part detector here so Burma's chip path stays byte-identical when palauTimecodes is off.
const TIMECODE3_RE_G = /(?<!\d)(?<!\d:)\d{2}:\d{2}:\d{2}(?!:?\d)/g;
const PALAU_TIMECODE_RE = /(?<!\d)(?<!\d:)(?:\d{2}:\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})(?!:?\d)/;
const PALAU_TIMECODE_RE_G = /(?<!\d)(?<!\d:)(?:\d{2}:\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})(?!:?\d)/g;
const PALAU_BRACKET_DURATION_RE = /^\d+(?:\.\d+)?$/;

const BURMA_DAY_CLASS = '123';
const BURMA_HEAD_ALTERNATION = 'COLD\\s*OPEN|HISTORY|GROUND|INQUIRY|LATM|ACT|EPILOGUE|OUTRO|TEASER|INTRO';
const STRUCTURAL_HEAD_WORDS = ['ACT', 'EPILOGUE', 'OUTRO', 'TEASER', 'INTRO'];

export function buildDayCharacterClass(days) {
  const nums = (Array.isArray(days) ? days : [])
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 9)
    .sort((a, b) => a - b);
  const uniq = nums.filter((day, index) => index === 0 || day !== nums[index - 1]);
  if (!uniq.length) return BURMA_DAY_CLASS;
  const contiguous = uniq.every((day, index) => index === 0 || day === uniq[index - 1] + 1);
  if (contiguous && uniq.length > 2) return `${uniq[0]}-${uniq[uniq.length - 1]}`;
  return uniq.join('');
}

function episodeDayCharacterClass() {
  try {
    const cls = buildDayCharacterClass(getEpisode()?.days);
    // Validate IN THE MODULE SHAPE. DAY_LOCAL/DAY_BLOCK below compile `[${cls}]` into a
    // char-class with a bare `new RegExp` — a class source with a regex-hostile char (a
    // legacy/hand-edited/future episode `days` that slips past buildDayCharacterClass) would
    // throw AT IMPORT and brick the whole document-builder. Test-compile here so a bad source
    // degrades to the known-good Burma class instead of taking the editor down.
    new RegExp(`\\bDAY\\s*([${cls}])\\b`, 'i');
    return cls;
  } catch (_err) {
    return BURMA_DAY_CLASS;
  }
}

export function episodeHeadAlternation() {
  try {
    const heads = (getEpisode()?.genres || []).map((genre) => genre?.head).filter(Boolean);
    if (!heads.length) return BURMA_HEAD_ALTERNATION;
    const alternation = [...heads, ...STRUCTURAL_HEAD_WORDS].join('|');
    // Validate IN THE MODULE SHAPE. ACT_HEAD / ACT_LABEL_RE / HEAD_BODY_SPLIT_RE below each
    // compile `^(${alternation})…` with a bare `new RegExp` — a single malformed `head`
    // fragment in ANY episode config (a stray unbalanced paren/bracket, a bad quantifier)
    // would throw AT IMPORT and brick the ENTIRE document-builder (the whole script editor)
    // with no recovery. Test-compile here so a bad config degrades to the frozen, known-good
    // Burma alternation instead of taking the editor down.
    new RegExp(`^(${alternation})\\b`, 'i');
    return alternation;
  } catch (_err) {
    return BURMA_HEAD_ALTERNATION;
  }
}

const DAY_CLASS_SOURCE = episodeDayCharacterClass();
// The timecode-behavior gate is the episode's `palauTimecodes` feature flag, read LIVE at every
// consumer via episodeFlag (the old module-frozen IS_PALAU const could silently freeze to the
// wrong episode if this module was imported before episode selection). Flagged episodes widen
// inline timecode parsing while Burma keeps the exact same broadcast-only regex path and rendered
// output it had before.
const DAY_LOCAL = new RegExp(`\\bDAY\\s*([${DAY_CLASS_SOURCE}])\\b`, 'i');
const DAY_LOCAL_G = new RegExp(`\\bDAY\\s*([${DAY_CLASS_SOURCE}])\\b`, 'ig');
const DAY_TRAILING = new RegExp(`(\\bDAY\\s*([${DAY_CLASS_SOURCE}])\\b)\\s*$`, 'i');
const DAY_BLOCK = new RegExp(`\\bDAY\\s*([${DAY_CLASS_SOURCE}])\\b`, 'i');
const HEAD_ALTERNATION = episodeHeadAlternation();
const ACT_HEAD = new RegExp(`^(${HEAD_ALTERNATION})\\b`, 'i');
const ACT_LABEL_RE = new RegExp(`^(${HEAD_ALTERNATION})(\\s*\\d+)?`, 'i');
const HEAD_BODY_SPLIT_RE = new RegExp(`^(${HEAD_ALTERNATION})(\\s*\\d+)?\\s*[.:–—-]?\\s*`, 'i');

// Running DAY context for the timecode chip's `day` attr (#2). Set per-block by inlineContent /
// headingNodes from the block's own day (sot/broll) or the nearest preceding DAY N. A bare module
// variable is safe here because buildEditorDocument walks blocks strictly in order, single-threaded.
let _ctxDay = null;

// Running SEQUENCE context for the timecode chip's `seq` attr (Palau). Threaded per-block exactly
// like _ctxDay: a named SOT/broll contributes its speaker as the sequence, a loose day-based block
// contributes "DAY N". Burma never sets this (palauTimecodes off) so its chips carry no seq. Single-
// threaded, in document order, so a bare module variable is safe (mirrors _ctxDay).
let _ctxSeq = null;

// Normalize a speaker to a single clean sequence-name line — drop leading bullets, collapse
// whitespace, keep the last non-empty line. Kept in step with the picker's cleanSeqLabel (marks.js)
// so a chip's stored seq dedupes to the SAME registry entry as its block's speaker.
function cleanSeqName(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\u2022\u25cf\u2219-]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// Coerce a DAY value to a clean integer. Some Palau blocks store timecode.day as the STRING
// "DAY 4" (not the number 4); a bare 'DAY ' + day then produced "DAY DAY 4" in a chip's seq and a
// string "DAY 4" in its data-day, so the "DAY N \u00b7 " chip prefix would have read "DAY DAY 4". This
// normalizes 4 / "4" / "DAY 4" \u2192 4 (and anything without a digit \u2192 null) so the running day + seq
// stay clean integers. Burma days are already numbers, so this is a no-op there.
function dayToNumber(d) {
  if (d == null) return null;
  if (typeof d === 'number') return Number.isFinite(d) ? d : null;
  const m = String(d).match(/\d+/);
  return m ? Number(m[0]) : null;
}

// PALAU (#2) \u2014 render the SOT's sequence NAME bold INLINE at the head of the body prose so it flows
// right before the timecodes + quote on the same line ("20260311-James Porter - Interview: [00:33:20]
// just take it in\u2026"), instead of stripping it out to a separate stacked chrome row. We keep the name
// in the body (it's already in the source text), find its first plain-text occurrence, and wrap just
// that run in a bold mark; if the body somehow lacks it we prepend it bold so the sequence is always
// labelled. DAY-style speakers ("DAY 4") are SKIPPED \u2014 those fold into the timecode chip via #1, they
// are not a named header. Burma never calls this (inlineSotName off).
function boldSequenceName(nodes, speaker) {
  const name = cleanSeqName(speaker);
  if (!name || /^DAY\s*\d/i.test(name)) return nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type !== 'text' || (n.marks && n.marks.length)) continue;
    const idx = n.text.indexOf(name);
    if (idx === -1) continue;
    const before = n.text.slice(0, idx);
    const after = n.text.slice(idx + name.length);
    const repl = [];
    if (before) repl.push({ type: 'text', text: before });
    repl.push({ type: 'text', text: name, marks: [{ type: 'bold' }] });
    if (after) repl.push({ type: 'text', text: after });
    nodes.splice(i, 1, ...repl);
    return nodes;
  }
  nodes.unshift({ type: 'text', text: name + ' ', marks: [{ type: 'bold' }] });
  return nodes;
}

function activeInlineTimecodeRegex() {
  const re = episodeFlag('palauTimecodes') ? PALAU_TIMECODE_RE_G : TIMECODE_RE_G;
  re.lastIndex = 0;
  return re;
}

function hasInlineTimecode(text) {
  if (!text) return false;
  if (episodeFlag('palauTimecodes')) {
    // Palau keeps [HH:MM:SS] interview in/out stamps inline. Check the dedicated 3-part form
    // first so bracketed [00:03:41][4.8] yields a clean timecode chip and leaves [4.8] as prose,
    // never as a merged 00:03:414.8 blob. Burma never touches this branch.
    TIMECODE3_RE_G.lastIndex = 0;
    if (TIMECODE3_RE_G.test(text)) return true;
    return PALAU_TIMECODE_RE.test(text);
  }
  return TIMECODE_RE.test(text);
}

function lastDayInText(text) {
  if (!text) return null;
  DAY_LOCAL_G.lastIndex = 0;
  let day = null;
  let match;
  while ((match = DAY_LOCAL_G.exec(text)) !== null) day = Number(match[1]);
  return day;
}

function trailingDayStamp(text) {
  const hit = String(text || '').match(DAY_TRAILING);
  return hit ? Number(hit[2]) : null;
}

// Push `text` onto `out` as TipTap text nodes, splitting out EVERY embedded timecode into its
// own node carrying the 'timecode' mark (a clickable copy-chip carrying the bare tc + the running
// DAY) — ON TOP of any base marks the surrounding span supplies. This is what tags timecodes
// nested INSIDE a {tk …}/[visual …] span (e.g. "[B roll of hotels on DAY 2 00:09:19:03]") as well
// as in bare prose, and now those glued to a word with no space. baseMarks may be undefined (bare
// prose) or a span mark array. The chip's `tc` is the bare code (the only thing a click copies);
// `day` is the running context day so the chip can DISPLAY "DAY N · …" (never "DAY null").
function pushTextWithTimecodes(out, text, baseMarks) {
  if (!text) return;
  // A local "DAY N" inside this very fragment overrides the block/running context for chips
  // that follow it in the same fragment (so "shot DAY 3 02:00:00:00" tags as DAY 3).
  const opts = (arguments.length > 3 && arguments[3]) || null;
  const suppressDay = !!opts?.suppressDay;
  let localDay = suppressDay ? null : _ctxDay;
  // The chip's sequence identity does NOT depend on suppressDay (which only hides the DAY display):
  // a Palau interview stamp is still part of its interview sequence. Burma leaves _ctxSeq null.
  const localSeq = episodeFlag('palauTimecodes') ? _ctxSeq : null;
  let last = 0, m;
  const timecodeRe = activeInlineTimecodeRegex();
  while ((m = timecodeRe.exec(text)) !== null) {
    let bundledDay = null;
    if (m.index > last) {
      let seg = text.slice(last, m.index);
      if (!suppressDay) {
        bundledDay = trailingDayStamp(seg);
        const segDay = bundledDay ?? lastDayInText(seg);
        if (segDay != null) localDay = segDay;
      }
      // palauTimecodes flag: the timecode chip DISPLAYS "DAY N · …" from its day attr, so a
      // literal "DAY N" sitting right before the chip is a visible DUPLICATE (Johnny: "it should
      // only be in the chip"). Fold it INTO the chip — strip the trailing "DAY N" from the visible
      // text. Burma (flag off) keeps its literal DAY prefix unchanged.
      if (episodeFlag('palauTimecodes') && bundledDay != null) {
        seg = seg.replace(DAY_TRAILING, '');
        if (seg && !/\s$/.test(seg)) seg += ' ';
      }
      if (seg) out.push({ type: 'text', text: seg, ...(baseMarks ? { marks: baseMarks } : {}) });
    }
    const tcAttrs = { tc: m[0], day: localDay ?? null, bundledDay: !!(episodeFlag('palauTimecodes') && bundledDay != null) };
    if (localSeq != null) tcAttrs.seq = localSeq; // Palau only — Burma omits the key entirely.
    const tcMark = { type: 'timecode', attrs: tcAttrs };
    out.push({ type: 'text', text: m[0], marks: baseMarks ? [...baseMarks, tcMark] : [tcMark] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last), ...(baseMarks ? { marks: baseMarks } : {}) });
}

// A heading (chapter/scene) is plain text — but the parser sometimes packs a timecode into the
// title clause ("(fake) PAGODA: DAY 2 02:45:36:15 …"). Tag those so every timecode is a chip.
function headingNodes(heading) {
  const out = [];
  pushTextWithTimecodes(out, heading || ' ');
  return out.length ? out : [{ type: 'text', text: heading || ' ' }];
}

// Set the running DAY for chips emitted by the next inlineContent/headingNodes call. Derived from
// the block's own timecode day (sot/broll) or the nearest preceding "DAY N" the builder has seen.
function setContextDay(day) { _ctxDay = day ?? null; }

// Set the running SEQUENCE for chips emitted by the next inlineContent/headingNodes call (Palau).
function setContextSeq(seq) { _ctxSeq = seq || null; }

function inlineContent(rawText, type) {
  const text = stripLead(rawText, type);
  if (!text) return [{ type: 'text', text: ' ' }];

  const out = [];
  // Combined splitter: {tk …}/{fc …} brace tokens, [visual] brackets, AND every embedded
  // broadcast timecode. Order in the alternation lets a timecode INSIDE a {tk …} stay part
  // of the brace token (the brace alternative wins because it starts earlier / is matched
  // first at that index). Standalone timecodes in plain prose get their own chip.
  const re = /(\{[^{}]*\}|\[[^\[\]]*\]|~~[^~]+~~)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Plain prose between spans — split out any bare timecodes as their own copy-chips.
    if (m.index > last) pushTextWithTimecodes(out, text.slice(last, m.index));
    const tok = m[0];

    const isBrace = tok[0] === '{';
    const isTrim = tok[0] === '~';
    const isBracket = tok[0] === '[';
    // A {…} brace token is EITHER a fact-check ask ({fc …}/{fact …}) or a {tk …} writing
    // ask. Sniff the keyword to route to the right mark — the two are visually distinct and
    // open the Workshop hub in different modes (fc → verify; tk → 5 options).
    const isFc = isBrace && /^\{\s*(?:fc|fact)\b/i.test(tok);
    // {fn …} is a FOOTNOTE token (footnoteToken's inverse) — rebuild the real fcFootnote
    // atom, never a tk/fc mark, so an export → rebuild round-trip keeps the receipt intact.
    if (isBrace && /^\{\s*fn\b/i.test(tok)) {
      const fnInner = tok.replace(/^\{\s*fn\s*/i, '').replace(/\}$/, '');
      const sep = fnInner.indexOf('||');
      // ` ∥ ` is footnoteToken's newline stand-in (multi-line findings / one-source-per-line) —
      // decode it back so the words rebuild exactly as written.
      const note = (sep >= 0 ? fnInner.slice(0, sep) : fnInner).trim().replace(FN_NL_RE, '\n');
      const source = (sep >= 0 ? fnInner.slice(sep + 2) : '').trim().replace(FN_NL_RE, '\n');
      out.push({ type: 'fcFootnote', attrs: { noteId: null, note, source, marker: '', verdict: '' } });
      last = m.index + tok.length;
      continue;
    }
    // {bm <id>} is an inline BOOKMARK token (bookmarkToken's inverse) — rebuild the real bookmark
    // atom so an export → rebuild round-trip keeps the place-mark (and its deep link) intact.
    if (isBrace && /^\{\s*bm\b/i.test(tok)) {
      const id = tok.replace(/^\{\s*bm\s*/i, '').replace(/\}$/, '').trim() || null;
      out.push({ type: 'bookmark', attrs: { bookmarkId: id } });
      last = m.index + tok.length;
      continue;
    }
    const markType = isTrim ? 'trimSpan' : (isBrace ? (isFc ? 'factCheckSpan' : 'tkSpan') : 'visualSpan');
    // Strip only the STRUCTURAL braces/brackets — KEEP the leading keyword ("tk"/"fc") in the
    // visible chip text, matching the CARTRIDGES reference ("tk fractured-shape", "tk ~one
    // fifth"). This is also the integrity-correct behaviour: the keyword is a real word in the
    // original script, so keeping it means no words are dropped (the audit sees every word).
    // nodeText.wrapToken is keyword-aware so the export round-trip stays single-keyword.
    const inner = isTrim
      ? tok.slice(2, -2)                                  // keep struck words verbatim, drop only the ~~
      : (isBrace
        ? tok.replace(/^\{\s*/, '').replace(/\}$/, '').trim()
        : tok.replace(/^\[\s*/, '').replace(/\]$/, '').trim());
    if (episodeFlag('palauTimecodes') && isBracket && PALAU_BRACKET_DURATION_RE.test(inner)) {
      // Palau interview durations are not readable prose; the IN/OUT stamps already carry the
      // useful timing. Drop the visible "[4.8]" token so it can't leak beside the seq tag.
      last = m.index + tok.length;
      continue;
    }
    if (episodeFlag('palauTimecodes') && isBracket && hasInlineTimecode(inner)) {
      // Palau SOT bodies use bare bracketed interview stamps ("[00:03:41]") that are NOT
      // visual-direction tokens. Route them through the same timecode-mark path as prose so
      // every SOT stamp becomes a wp-tc-tag copy chip, while Burma keeps its old [visual] path.
      // These interview stamps are NOT DAY-style shoot codes, so suppress the running DAY prefix.
      pushTextWithTimecodes(out, inner || tok, null, { suppressDay: true });
      last = m.index + tok.length;
      continue;
    }
    // Emit the span — but a timecode embedded INSIDE the span ("[… DAY 2 00:09:19:03]") gets
    // BOTH the span mark AND a timecode chip mark, so every timecode is clickable/copyable.
    const spanMark = { type: markType };
    if (hasInlineTimecode(inner)) {
      pushTextWithTimecodes(out, inner || tok, [spanMark]);
    } else {
      out.push({ type: 'text', text: inner || tok, marks: [spanMark] });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) pushTextWithTimecodes(out, text.slice(last));
  return out.length ? out : [{ type: 'text', text: ' ' }];
}

function para(content) {
  return { type: 'paragraph', content: content && content.length ? content : undefined };
}

// ---- chapter reclassification (THE CADENCE FIX) --------------------------
// The upstream parser is greedy about CHAPTER: any short ALL-CAPS-ish line that *looks*
// like a divider ("LOOK AT THIS MAP ON CAM MONOLOGUE", "HISTORY 2 BRITISH x walk and talk")
// got tagged `chapter`, so the rack opened on a wall of FOUR dark inverted cartridges, not
// the loved reference's CHAPTER → VO → SOT cadence. We can't (and shouldn't) re-run the
// parser; instead we reclassify at build time, the same place we already clamp titles and
// flag scaffold bins. A TRUE act divider is a short section label — COLD OPEN / HISTORY n /
// GROUND n / INQUIRY / LATM / ACT — with no scene-direction tail. Anything carrying on-cam,
// monologue, walk-and-talk, or other directing language is narration mis-filed as a divider:
// demote it to ONCAM (it's a person on camera / a spoken beat), so the colour returns to the
// rack and the dark CHAPTER bar is reserved for genuine new sections.
const DIRECTION_WORDS = /\b(ON[\s-]?CAM|MONOLOGUE|WALK\s*AND\s*TALK|WALK\s*&\s*TALK|VOICEOVER|\bVO\b|PIECE\s*TO\s*CAMERA|PTC|SEQUENCE|MAP\b)/i;

// Trim a divider title down to its clean act label, dropping any directing tail the parser
// glued on ("HISTORY 2 BRITISH x walk and talk" → "HISTORY 2"). Keeps the dark cartridge
// reading as a crisp section marker. The tail is NOT lost — chapterBody() emits it as a
// paragraph under the heading (integrity fix: the chapter's body text reaches the page).
export function actLabel(title) {
  let t = clean(title).replace(/\s+/g, ' ').trim();
  const m = t.match(ACT_LABEL_RE);
  if (m) return m[0].toUpperCase().replace(/\s+/g, ' ').trim();
  return t;
}

// THE SOURCE-OF-TRUTH FIX. The upstream parser TRUNCATED long content into b.title / b.text
// but preserved the COMPLETE original line in b.rawSource (verified: 57 timecodes + many
// lines live ONLY in rawSource). rawSource is therefore the authoritative, lossless content.
// bodyText returns the richest available text — rawSource when it carries more than text/title,
// else the cleaned text/title. Nothing the parser captured is dropped.
function bodyText(b) {
  const text = clean(b.text || '');
  const title = clean(b.title || '');
  const raw = clean(b.rawSource || '');
  const base = text || title;
  // rawSource wins whenever it carries MORE than the (possibly truncated / prefix-stripped)
  // body — even a small delta like a leading "VO:" the parser dropped is real content the
  // integrity audit counts. Only fall back to base when rawSource adds nothing.
  if (raw && raw.length > base.length) return raw;
  return base;
}

// THE CHAPTER/SCENE-BODY INTEGRITY FIX: a chapter rendered ONLY its act label, throwing away
// the rest (COLD OPEN's "Candidates: 1. DAY 2 … 02:32:21:22 …" notes, INQUIRY's theme list).
// Strip the structural leading label ("CH:", "SCENE:") + the recognized act head off the front
// of the FULL source text and return EVERYTHING after it as body prose — nothing dropped.
export function headBodySplit(rawTitle, headLabel) {
  let t = clean(rawTitle).replace(/\s+/g, ' ').trim();
  // Peel the structural section markers the parser kept ("CH:", "⁃ SCENE:", "SCENE").
  t = t.replace(/^[⁃•‣·\s-]*CH\s*[:.]?\s*/i, '').replace(/^[⁃•‣·\s-]*SCENE\s*[:.]?\s*/i, '').trim();
  const head = clean(headLabel).replace(/\s+/g, ' ').trim();
  let body = t;
  // Try to peel the recognized act head (e.g. "HISTORY 2") off the front.
  const m = t.match(HEAD_BODY_SPLIT_RE);
  if (m) body = t.slice(m[0].length).trim();
  else if (head && t.toUpperCase().startsWith(head.toUpperCase())) body = t.slice(head.length).replace(/^\s*[.:–—-]\s*/, '').trim();
  return body;
}

// Decide what a parser-labelled `chapter` REALLY is.
//   'chapter' → keep (true act divider; title will be clamped to the act label)
//   'oncam'   → demote (it's narration / a directed on-cam beat, not a section)
export function reclassifyChapter(b) {
  const title = clean(b.title || '');
  const head = ACT_HEAD.test(title);
  const hasDirection = DIRECTION_WORDS.test(title);
  // Pure act head (e.g. "HISTORY 1", "GROUND 1", "INQUIRY", "COLD OPEN FROM JH") → keep,
  // even if a directing word trails it ("HISTORY 2 … walk and talk") — actLabel will clamp it.
  if (head) return 'chapter';
  // No act head + directing language ("LOOK AT THIS MAP ON CAM MONOLOGUE") → demote to oncam.
  if (hasDirection) return 'oncam';
  // No act head, no directing words, but long/sentence-like → it's a stray prose line the
  // parser over-promoted; demote to scene so it reads as a quiet sub-heading, not a dark act.
  if (title.length > 40 || /[.!?]/.test(title)) return 'scene';
  return 'chapter';
}

// ---- per-block -> node ---------------------------------------------------
// `opts.scaffold` marks a leading BIN block that sits BEFORE the first chapter — author
// setup notes ("read this only after…", "this is the actual script…"). They are real data
// (kept, editable, round-tripping), but the script must OPEN on the masthead then CH 01, not
// on instructions-to-self. We tag them so the BIN node renders a quiet collapsed strip.
function blockToNode(b, opts) {
  const node = blockToTypedNode(b, opts);
  // pendingViz (/pending — PENDING VISUAL PLAN) rides EVERY cartridge type uniformly, so it is
  // merged here centrally instead of per-case: nodeToBlock emits it only when true, and this
  // restores it on the way back. Absent → untouched (byte-identical for every existing doc).
  if (b.pendingViz && node.attrs) node.attrs = { ...node.attrs, pendingViz: true };
  return node;
}

function blockToTypedNode(b, opts) {
  const id = b.id;
  // Reclassify over-eager CHAPTER labels BEFORE the switch so demoted ones flow into the
  // right node branch (oncam / scene) and pick up colour instead of a dark divider bar.
  if (b.type === 'chapter') {
    const real = reclassifyChapter(b);
    if (real === 'oncam') b = { ...b, type: 'oncam', text: b.text || b.title };
    else if (real === 'scene') b = { ...b, type: 'scene', title: b.title };
  }
  // The "service need" concept is GONE. Legacy map-need / archive-req blocks demote to a neutral
  // 'bin' (DIRECTION) cartridge everywhere downstream — every word of the body survives via
  // inlineContent, nothing is special-cased. (See demoteServiceNodes for the saved-doc path.)
  if (b.type === 'map-need' || b.type === 'archive-req') b = { ...b, type: 'bin' };
  switch (b.type) {
    case 'chapter': {
      // Heading = clean act label. BODY = the remaining title text (COLD OPEN's candidate
      // notes, INQUIRY's theme list, embedded timecodes) — emitted as prose so NOTHING is
      // dropped. inlineContent tags every embedded timecode/{tk}/[visual] as a chip.
      const heading = actLabel(b.title) || headingClause(b.title, 64) || 'Chapter';
      // Body = the FULL source (rawSource) minus the heading clause — keeps every candidate
      // note + embedded timecode the parser truncated out of b.title.
      const body = headBodySplit(bodyText(b), heading);
      const content = [para(headingNodes(heading))];
      if (body) content.push(para(inlineContent(body, 'plain')));
      return { type: 'chapterBlock', attrs: { blockId: id, genre: b.genre || 'other' }, content };
    }

    case 'scene': {
      const heading = headingClause(b.title, 80) || 'Scene';
      const body = headBodySplit(bodyText(b), heading);
      const content = [para(headingNodes(heading))];
      if (body) content.push(para(inlineContent(body, 'plain')));
      return { type: 'sceneBlock', attrs: { blockId: id }, content };
    }

    case 'vo':
      return {
        type: 'voBlock',
        attrs: { blockId: id, status: b.voStatus || 'todo' },
        content: [para(inlineContent(bodyText(b), 'vo'))],
      };

    case 'oncam':
      return {
        type: 'oncamBlock',
        attrs: { blockId: id },
        content: [para(inlineContent(bodyText(b), 'oncam'))],
      };

    case 'sot':
      {
        const quote = cleanQuote(bodyText(b));
        // PALAU (#2): keep the sequence NAME in the body and render it bold INLINE (flowing right
        // before the timecodes + quote), rather than stripping it out to a separate chrome row. Burma
        // keeps the plain quote unchanged.
        const bodyNodes = episodeFlag('inlineSotName')
          ? boldSequenceName(inlineContent(quote, 'plain'), b.speaker || '')
          : inlineContent(quote, 'plain');
      return {
        type: 'sotBlock',
        attrs: {
          blockId: id,
          timecode: formatTimecode(b.timecode?.tc),
          // OUT/range-end timecode (frame-accurate range editors live by). Carried so it
          // survives docToBlocks round-trip instead of silently vanishing into body prose.
          tcOut: b.timecode?.tcOut || '',
          rawTimecode: b.timecode?.raw || b.timecode?.tc || '',
          day: b.timecode?.day ?? null,
          ambiguous: !!b.timecode?.ambiguous,
          speaker: b.speaker || '',
          done: !!b.done,
          flavor: b.flavor ?? null,
        },
        content: [para(bodyNodes)],
      };
      }

    case 'broll':
      return {
        type: 'brollBlock',
        attrs: {
          blockId: id,
          timecode: formatTimecode(b.timecode?.tc),
          tcOut: b.timecode?.tcOut || '',
          rawTimecode: b.timecode?.raw || b.timecode?.tc || '',
          day: b.timecode?.day ?? null,
          ambiguous: !!b.timecode?.ambiguous,
          speaker: b.speaker || '',
          done: !!b.done,
          flavor: b.flavor ?? null,
        },
        content: [para(inlineContent(cleanQuote(bodyText(b)), 'plain'))],
      };

    case 'note':
    case 'jh-note':
      return {
        type: 'noteBlock',
        attrs: { blockId: id, kind: b.type },
        content: [para(inlineContent(bodyText(b), 'plain'))],
      };

    case 'montage':
      return {
        type: 'montageBlock',
        attrs: { blockId: id },
        content: [para(inlineContent(bodyText(b), 'plain'))],
      };

    case 'image':
      // ADDITIVE image support: an ATOM node — the src / caption / kind live entirely in attrs
      // (reconstruction-complete, WP-13), no editable content. Burma/Palau blocks arrays contain
      // no type:"image", so this branch never fires for them and their docs are byte-identical.
      return {
        type: 'imageBlock',
        attrs: {
          blockId: id,
          src: b.imageSrc || '',
          alt: b.imageAlt || '',
          kind: b.imageKind === 'inspo' ? 'inspo' : 'shot',
          // width (px int) + crop ({x,y,w,h} 0..1) — additive; absent → null (byte-identical for
          // every existing image block). Crop shape guard mirrors blocks.js isValidCrop's contract.
          width: Number.isFinite(b.imageWidth) ? b.imageWidth : null,
          crop: imageCropShapeOk(b.imageCrop) ? b.imageCrop : null,
          flavor: b.flavor ?? null,
        },
      };

    case 'none':
      // A "born" block with no chosen type yet — a chrome-less editable line. It still routes
      // its body through inlineContent so anything already typed (chips included) survives.
      return {
        type: 'noneBlock',
        attrs: { blockId: id },
        content: [para(inlineContent(bodyText(b), 'plain'))],
      };

    case 'bin':
    default:
      return {
        type: 'binBlock',
        attrs: { blockId: id, scaffold: !!(opts && opts.scaffold) },
        content: [para(inlineContent(bodyText(b), 'plain'))],
      };
  }
}

// ---- TABLE SPINE wrapping (SPINE BUILDER #3) ----------------------------
// The document is now a STACK OF ROWS. Every top-level block node is wrapped into
//   tableRow(cols:1) > tableCell(role:'full') > [ block ]
// so the whole doc renders as a vertical stack of FULL-WIDTH rows (one full-width cell
// each) wrapping the existing cartridge content. Chapters/scenes are full-width header
// rows by the same wrapping. The split/merge feature later turns a 1-cell row into a
// 2-cell row (LEFT said / RIGHT shown) — the schema already allows tableCell+.
//
// scriptStart is a decorative divider that lives at the doc's top level too — wrap it the
// same way so the schema stays uniform (doc content is tableRow+). It carries no words, so
// the audit is unaffected.
function fullWidthRow(blockNode) {
  return {
    type: 'tableRow',
    attrs: { cols: 1 },
    content: [
      { type: 'tableCell', attrs: { role: 'full' }, content: [blockNode] },
    ],
  };
}

function pairedRow(pairId, saidNodes, shownNodes) {
  return {
    type: 'tableRow',
    attrs: { cols: 2, pairId },
    content: [
      { type: 'tableCell', attrs: { role: 'said' }, content: saidNodes },
      { type: 'tableCell', attrs: { role: 'shown' }, content: shownNodes },
    ],
  };
}

function isPalauEpisodeNow() {
  // normalizeTableRows flag — the ONE transform here that rewrites a SAVED doc on load. Must be
  // read LIVE, and must stay OFF for Burma (Burma's config sets no flags).
  return episodeFlag('normalizeTableRows');
}

function rowBlocks(row) {
  const blocks = [];
  if (row?.type !== 'tableRow') return blocks;
  for (const cell of row.content || []) {
    if (cell?.type !== 'tableCell') continue;
    for (const block of cell.content || []) blocks.push(block);
  }
  return blocks;
}

function rowHasVisibleWords(row) {
  for (const block of rowBlocks(row)) {
    if (block?.type === 'paragraph' && isEmptyPlaceholderPara(block)) continue;
    // An image block carries no TEXT but is absolutely visible content — the empty-row culler
    // must never drop it (its words live in attrs.alt, not in text nodes).
    if (block?.type === 'imageBlock') return true;
    // A bookmark is a visible glyph AND a deep-link target — like an imageBlock it carries no text,
    // so the empty-row culler must never treat a bookmark-bearing block as word-less.
    if (hasBookmarkedRow(block)) return true;
    if (nodeText(block).trim()) return true;
  }
  return false;
}

function splitPalauFullWidthRow(row) {
  if (row?.type !== 'tableRow') return [row];
  if ((row.content || []).length !== 1) return [row];
  const cell = row.content[0];
  if (cell?.type !== 'tableCell') return [row];
  const blocks = (cell.content || []).filter(Boolean);
  if (blocks.length <= 1) return [row];
  // A stale Palau saved doc can stack multiple cartridges inside one full-width cell. Split each
  // block back into its own top-level row so chapter/scene headers regain the fresh-build shape.
  const rows = blocks.map((block) => fullWidthRow(block));
  // KEEP-ME marker survival (audit 2026-07-07 follow-up): a bookmark lives on the ROW attrs, not
  // the block — and fullWidthRow() mints fresh {cols:1} attrs, so re-wrapping a bookmarked stacked
  // row here would silently DROP its ⚑ (a visible glyph AND a deep-link target). The same audit
  // taught the culler hasBookmarkedRow; this closes the split-side hole so the bookmark survives
  // the split too. Carry it onto the FIRST split row only — a bookmarkId must stay unique (a
  // duplicate data-bookmark-id makes the ?bm deep link ambiguous). Byte-identical when unbookmarked.
  if (row.attrs?.bookmarkId && rows[0]) {
    rows[0] = { ...rows[0], attrs: { ...rows[0].attrs, bookmarkId: row.attrs.bookmarkId } };
  }
  return rows;
}

// A row the author DELIBERATELY added with the "+" row tool (table.js doAddRowsBelow) carries a
// `pairu_`-prefixed pairId. Such a row must survive the empty-band culler below even while it is
// still word-less — the author just created it to type into; silently dropping it on the next
// load would be data-loss of intent. Once typed into, rowHasVisibleWords keeps it anyway.
// RECURSIVE: Palau's stale-doc shape nests rows (tableRow > tableCell > tableRow), and
// splitPalauFullWidthRow re-wraps a nested row into a fresh full-width row whose own attrs
// carry no pairId — so the pairu_ marker must be found at ANY depth of the candidate row.
// CANONICAL: this is the ONE source of the pairu_ predicate. migrate-doc.js (the pristine-source
// rebuild guard) and the add-rows suite import it from here instead of hand-copying the body, so
// the two data-loss guards can never drift apart.
export function hasUserAddedRow(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'tableRow' && typeof node.attrs?.pairId === 'string' && node.attrs.pairId.startsWith('pairu_')) return true;
  return Array.isArray(node.content) && node.content.some(hasUserAddedRow);
}

// BOOKMARK twin of the pairu_ predicate (audit 2026-07-07): a row the author bookmarked is a
// deliberate mark of intent exactly like a row added with the "+" tool — the Palau empty-row
// cull and the pristine-source rebuild must both treat it as keep-me, or the ⚑ (and, for a
// still-empty spacer row, the row itself) silently vanishes on the next load.
export function hasBookmarkedRow(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'tableRow' && node.attrs?.bookmarkId) return true;
  // INLINE BOOKMARK (Johnny 2026-07-08 /bookmark): the new inline `bookmark` node is a deliberate
  // keep-me mark exactly like the row-attr ⚑ — and it carries NO text, so a row whose only content
  // is a bookmark reads as word-less to rowHasVisibleWords and would be culled on the next save
  // normalize (the "it appeared then vanished a second later" bug). Detecting it here makes the
  // empty-row cull AND the pristine-source rebuild both treat it as keep-me, wherever it sits.
  if (node.type === 'bookmark') return true;
  return Array.isArray(node.content) && node.content.some(hasBookmarkedRow);
}

function normalizePalauTableDoc(doc) {
  if (!isPalauEpisodeNow() || !doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return doc;
  const content = [];
  for (const row of doc.content) {
    const splitRows = row?.type === 'tableRow' ? splitPalauFullWidthRow(row) : [row];
    for (const splitRow of splitRows) {
      // Drop only rows that carry no visible words at all; this removes stray empty grid bands
      // without touching any real script text or timecodes. Rows the author added on purpose
      // with the "+" row tool (pairu_ pairId) are KEPT even while still empty.
      if (splitRow?.type === 'tableRow' && !rowHasVisibleWords(splitRow) && !hasUserAddedRow(splitRow) && !hasBookmarkedRow(splitRow)) continue;
      content.push(splitRow);
    }
  }
  return { ...doc, content };
}

export function buildEditorDocument(blocks) {
  const list = (blocks || []).filter(Boolean);
  // Everything before the first chapter is pre-script author scaffolding. Flag the
  // leading BIN notes so they surface as PRE-SCRIPT NOTE boxes (masthead → notes →
  // ▸ SCRIPT BEGINS → CH 01), not buried under a collapsed toggle.
  const firstChapter = list.findIndex((b) => b.type === 'chapter');

  const entries = [];
  // Running DAY context for inline timecode chips (#2). Threads the nearest preceding DAY N
  // across blocks exactly like parser.ts's contextDay, so a chip with no explicit local day
  // still shows the right "DAY N · …". A block's own timecode.day (sot/broll) takes precedence.
  let runningDay = null;
  list.forEach((b, i) => {
    // Update the running day from this block's explicit DAY N (in its timecode or its text).
    const blockDay = dayToNumber(b?.timecode?.day ?? (() => {
      const src = (b.rawSource || b.text || b.title || '');
      const dm = String(src).match(DAY_BLOCK);
      return dm ? dm[1] : null;
    })());
    if (blockDay != null) runningDay = blockDay;
    // Running SEQUENCE (Palau): a named SOT/broll carries its speaker as the sequence; anything else
    // (chapters, VO, day string-outs) falls back to the running DAY as "DAY N". This is what stops a
    // James-Porter interview chip from defaulting to a DAY — it becomes the interview's own sequence.
    if (episodeFlag('palauTimecodes')) {
      const spk = (b.type === 'sot' || b.type === 'broll') ? cleanSeqName(b.speaker) : '';
      const blockSeq = spk || (runningDay != null ? 'DAY ' + runningDay : null);
      setContextSeq(blockSeq);
    }
    setContextDay(runningDay);
    // FEATURE B — emit the ▸ SCRIPT BEGINS divider right before the first real chapter,
    // visually starting the script after the pre-script (masthead lives in chrome; the
    // leading scaffold bins render as open NOTE boxes via their is-scaffold flag).
    if (firstChapter > 0 && i === firstChapter) {
      entries.push({ node: { type: 'scriptStart', attrs: {} }, block: null });
    }
    const node = blockToNode(b, { scaffold: b.type === 'bin' && firstChapter > 0 && i < firstChapter });
    if (node) entries.push({ node, block: b });
  });
  setContextDay(null);
  setContextSeq(null);

  // ProseMirror requires at least one child.
  if (!entries.length) {
    entries.push({
      node: { type: 'binBlock', attrs: { blockId: 'empty' }, content: [para([{ type: 'text', text: ' ' }])] },
      block: null,
    });
  }

  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const { node, block } = entries[i];
    const pairId = block?.pairId;
    if (!pairId || node?.type === 'scriptStart') {
      rows.push(fullWidthRow(node));
      continue;
    }

    const runNodes = [node];
    const runBlocks = [block];
    while (i + 1 < entries.length && entries[i + 1].block?.pairId === pairId) {
      runNodes.push(entries[i + 1].node);
      runBlocks.push(entries[i + 1].block);
      i++;
    }

    const saidNodes = [];
    const shownNodes = [];
    runNodes.forEach((runNode, runIndex) => {
      const lane = runBlocks[runIndex]?.lane;
      if (lane === 'said') saidNodes.push(runNode);
      else if (lane === 'shown') shownNodes.push(runNode);
    });

    if (saidNodes.length && shownNodes.length) rows.push(pairedRow(pairId, saidNodes, shownNodes));
    else runNodes.forEach((runNode) => rows.push(fullWidthRow(runNode)));
  }

  return { type: 'doc', content: rows };
}

// ---- migrate a PRE-TABLE saved doc (flat blocks at top level) into rows ----
// A localStorage doc saved before the table spine existed has block nodes directly under
// `doc`. Detect that shape and wrap each top-level block into a full-width row so an existing
// edited doc (Johnny's filled-in {tk}/{fc} answers) keeps rendering — NOTHING is dropped, the
// inline marks ride along untouched inside the wrapped block. Already-rowed docs pass through.
export function ensureTableDoc(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return doc;
  // SAFETY: a legacy saved doc may still contain serviceGroup / serviceItem / serviceBlock nodes
  // (the now-removed "service need" concept). Those node types are no longer registered in the
  // schema, so TipTap would SILENTLY DROP them (and every word inside) on load. Convert them to
  // neutral binBlocks FIRST — text-preserving — so no script content is lost on reload.
  doc = demoteServiceNodes(doc);
  const allRows = doc.content.length > 0 && doc.content.every((n) => n && n.type === 'tableRow');
  const rowed = allRows
    ? doc
    : { ...doc, content: doc.content.map((n) => (n && n.type === 'tableRow' ? n : fullWidthRow(n))) };
  // Mixed or flat — wrap any non-row top-level node into a full-width row (idempotent: a node
  // that is already a tableRow is kept as-is so a partially-migrated doc still normalises).
  return normalizePalauTableDoc(rowed);
}

// ---- legacy service-node demotion (text-preserving) ----------------------
// The "service need" concept (serviceGroup / serviceItem / serviceBlock) was removed. A doc
// already saved to localStorage may still carry those node shapes. This transform rewrites them
// into neutral binBlocks, copying their inline content VERBATIM so every word + chip mark
// survives — the migrate-doc text-equality gate proves it. Idempotent: a doc with no service
// nodes returns an equivalent doc unchanged. Walks doc → rows → cells → blocks AND bare-block
// (pre-table) docs, so every load path is covered.
function serviceItemToBin(item) {
  const a = item.attrs || {};
  return {
    type: 'binBlock',
    attrs: { blockId: a.blockId || null, scaffold: false },
    // Reuse the serviceItem's paragraph content verbatim — same words, same chip marks.
    content: (item.content && item.content.length)
      ? item.content
      : [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
  };
}
function serviceBlockToBin(node) {
  const a = node.attrs || {};
  return {
    type: 'binBlock',
    attrs: { blockId: a.blockId || null, scaffold: false },
    content: (node.content && node.content.length)
      ? node.content
      : [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
  };
}
// Expand one block-level node into the array of neutral blocks it demotes to. A serviceGroup
// becomes N binBlocks (one per serviceItem); a standalone serviceBlock becomes one binBlock;
// anything else passes through untouched.
function demoteBlockNode(node) {
  if (!node) return [node];
  if (node.type === 'serviceGroup') return (node.content || []).map(serviceItemToBin);
  if (node.type === 'serviceBlock') return [serviceBlockToBin(node)];
  return [node];
}
export function demoteServiceNodes(doc) {
  if (!doc || doc.type !== 'doc' || !Array.isArray(doc.content)) return doc;
  const content = [];
  for (const node of doc.content) {
    if (node?.type === 'tableRow') {
      // Walk the row's cells, demoting any service node inside each cell's block list.
      const cells = (node.content || []).map((cell) => {
        if (cell?.type !== 'tableCell') return cell;
        const blocks = [];
        for (const blk of cell.content || []) blocks.push(...demoteBlockNode(blk));
        return { ...cell, content: blocks };
      });
      content.push({ ...node, content: cells });
    } else {
      // Bare (pre-table) top-level node — demote in place, wrapping happens downstream.
      content.push(...demoteBlockNode(node));
    }
  }
  return { ...doc, content };
}

// ---- read the live doc back to a blocks array (for persistence) ----------
const NODE_TO_TYPE = {
  chapterBlock: 'chapter',
  sceneBlock: 'scene',
  voBlock: 'vo',
  oncamBlock: 'oncam',
  sotBlock: 'sot',
  brollBlock: 'broll',
  montageBlock: 'montage',
  noneBlock: 'none',
  noteBlock: null,
  binBlock: 'bin',
  imageBlock: 'image',
};

// Tree-walk a node to its plain text, RE-SERIALIZING the inline span marks back into
// their {tk …}/[…] tokens. Two cases must round-trip:
//   (a) seed + bubble-menu spans already carry literal braces inside the marked text →
//       we must NOT double-wrap them.
//   (b) a mark applied to bare text (e.g. via an input rule on a fragment, or a future
//       command that marks without braces) → we wrap it so the blocks export stays
//       faithful (low-priority round-trip fix). The doc JSON remains canonical; this
//       keeps docToBlocks() a faithful derived/export view.
export function wrapToken(text, kind) {
  const t = text;
  if (kind === 'tkSpan') {
    if (/^\{.*\}$/s.test(t.trim())) return t;        // already braced
    const inner = t.replace(/^\s+|\s+$/g, '');
    // The visible chip now KEEPS its "tk" keyword, so don't double-add it on export.
    return /^tk\b/i.test(inner) ? '{' + inner + '}' : '{tk ' + inner + '}';
  }
  if (kind === 'factCheckSpan') {
    if (/^\{.*\}$/s.test(t.trim())) return t;        // already braced
    const inner = t.replace(/^\s+|\s+$/g, '');
    return /^(?:fc|fact)\b/i.test(inner) ? '{' + inner + '}' : '{fc ' + inner + '}';
  }
  if (kind === 'visualSpan') {
    if (/^\[.*\]$/s.test(t.trim())) return t;        // already bracketed
    return '[' + t.replace(/^\s+|\s+$/g, '') + ']';
  }
  if (kind === 'trimSpan') {
    if (/^~~.*~~$/s.test(t.trim())) return t;            // already struck
    return '~~' + t.replace(/^\s+|\s+$/g, '') + '~~';
  }
  return t;
}

// fcFootnote → its `{fn <note> || <source>}` export token. Structural characters ({ } and
// the || separator) are scrubbed from the content so the token always re-parses cleanly;
// inlineContent's isFn branch is the inverse. marker/verdict are icon-side lineage — they
// are NOT encoded (the doc JSON is canonical for them; the token carries the WORDS).
// NEWLINES (2026-07-08 full-screen multi-source): note holds RECHECK's multi-line findings and
// source is one-per-line — a literal \n inside the single-line token would tear it apart on the
// paragraph-split rebuild. Encode \n as ` ∥ ` (U+2225, not a citation character) on export;
// FN_NL_RE below is the inverse. Round-trip locked by footnote-newline.test.mjs.
const FN_NL_TOKEN = ' ∥ ';
export const FN_NL_RE = /\s*∥\s*/g;
export function footnoteToken(attrs) {
  const clean = (s) => String(s || '')
    .replace(/[{}]/g, '').replace(/\|\|/g, '∕∕').replace(/∥/g, '∕')
    .replace(/\n+/g, FN_NL_TOKEN).trim();
  const note = clean(attrs?.note);
  const source = clean(attrs?.source);
  return '{fn ' + note + (source ? ' || ' + source : '') + '}';
}

// bookmark → its `{bm <id>}` export token; inlineContent's isBm branch is the inverse. The id is
// the only payload (a bookmark is a pure place-mark). A bookmark with no id round-trips to nothing.
export function bookmarkToken(attrs) {
  const id = String(attrs?.bookmarkId || '').replace(/[{}\s]/g, '');
  return id ? '{bm ' + id + '}' : '';
}

export function nodeText(node) {
  // Collect inline pieces tagged with their span-mark type, THEN coalesce consecutive
  // text nodes that share the same span type into ONE token before re-wrapping.
  // Why: inlineContent splits a span that contains an embedded timecode into multiple
  // text nodes (the timecode fragment gets an extra 'timecode' chip mark), but every
  // fragment still carries the span mark. Wrapping per-fragment exploded a single span
  // into several tokens on the round-trip — "[B roll … 00:09:19:03]" became
  // "[B roll …][00:09:19:03]" and "{tk … 02:02:01:07 …}" became three {tk …} tokens.
  // Reuniting same-span runs first re-serializes each span as exactly one token.
  const pieces = []; // { span: 'tkSpan'|'factCheckSpan'|'visualSpan'|'trimSpan'|null, text }
  (function walk(n) {
    // Separate block-level siblings (sibling paragraphs, and the paragraph inside each
    // list item) with a single line boundary so their words never run together on the
    // flattened export. Before lists/multi-paragraph bodies were allowed this never fired
    // (a block body was one paragraph); now a bulletList of clips or a multi-paragraph VO
    // would otherwise collapse to "first clipsecond clip" / "Line one.Line two.". The
    // boundary carries span:null so it is never coalesced into a span run, and a guard
    // skips it when the previous piece is already a boundary (empty middle paragraph) so a
    // blank paragraph can't double the separator.
    if (n.type === 'paragraph' && pieces.length) {
      const last = pieces[pieces.length - 1];
      if (!(last && last.span === null && last.text === '\n')) pieces.push({ span: null, text: '\n' });
    }
    if (n.text) {
      const marks = n.marks || [];
      const span = marks.find((m) => m.type === 'tkSpan' || m.type === 'factCheckSpan' || m.type === 'visualSpan' || m.type === 'trimSpan');
      const spanType = span ? span.type : null;
      const prev = pieces[pieces.length - 1];
      // Merge into the previous piece only when both carry the SAME (non-null) span —
      // that's a span fragmented by a timecode chip, never two distinct adjacent spans.
      if (prev && spanType !== null && prev.span === spanType) prev.text += n.text;
      else pieces.push({ span: spanType, text: n.text });
    }
    if (n.type === 'directionChip') {
      pieces.push({ span: null, text: directionChipText(n.attrs) });
    }
    if (n.type === 'fcFootnote') {
      // EXPORT LAW — the footnote's words (note + source) must survive the derived blocks
      // view. Serialized as the `{fn …}` token inlineContent() parses back into a real
      // fcFootnote node, so an export → rebuild round-trip never drops a fact-check word.
      pieces.push({ span: null, text: footnoteToken(n.attrs) });
    }
    if (n.type === 'bookmark') {
      // EXPORT LAW — the inline bookmark survives the derived blocks view as a {bm <id>} token
      // inlineContent() parses back into a real bookmark node, so its deep link is never dropped.
      const t = bookmarkToken(n.attrs);
      if (t) pieces.push({ span: null, text: t });
    }
    if (n.content) n.content.forEach(walk);
  })(node);
  let s = '';
  for (const p of pieces) s += p.span ? wrapToken(p.text, p.span) : p.text;
  return s.trim();
}

// A bare placeholder paragraph carries no words and no block identity. doSplitRow opens a
// brand-new SHOWN lane with exactly one empty paragraph (cursor-ready), so a freshly split row
// — the state on EVERY split, before the author types — has an empty bare paragraph as the
// shown cell's only child. Flattening it into a block would mint a phantom { type:'bin', text:'' }
// in the exported blocks array on every autosave. doMergeRow already drops this placeholder on
// the way back; docToBlocks must drop it on flatten too so the two agree. A shown paragraph the
// author HAS typed into still carries its words → kept (becomes a bin block, audit-safe).
const isEmptyPlaceholderPara = (n) =>
  n?.type === 'paragraph' &&
  (!Array.isArray(n.content) || n.content.every((c) => !c.text || !c.text.trim()));

export function docToBlocks(doc) {
  if (!doc?.content) return [];
  const out = [];
  // TABLE SPINE — the doc top level is now tableRow+. FLATTEN every row's cells back into the
  // stream of cartridge block nodes so the persisted/exported blocks array round-trips EXACTLY
  // as before (downstream tools + the schema contract never see the row scaffold). A full-width
  // row yields its one cell's blocks; a future split row yields LEFT then RIGHT cell blocks in
  // reading order. Backwards-safe: a bare (pre-table) block node is handled by the else branch.
  const flat = [];
  // Flatten one row's cells into `flat`, recursing into any NESTED tableRow found inside a
  // cell. The schema legally permits tableRow > tableCell > tableRow (Palau's saved docs ship
  // that shape, and PM's native block drag can mint it anywhere) — but NODE_TO_TYPE has no
  // 'tableRow' entry, so before this recursion a nested row fell through nodeToBlock and was
  // flattened to ONE type:'bin' block, destroying its blocks' types and SOT timecode/speaker
  // attrs on the next save. Recursing keeps a nested row's blocks first-class: a structural
  // oddity stays a lossless reorder problem instead of becoming data destruction.
  const flattenRow = (rowNode, fallbackPairId) => {
    const rowPairId = rowNode?.attrs?.pairId || fallbackPairId;
    const isPairedRow = (rowNode?.attrs?.cols || 0) === 2;
    let nestedIndex = 0;
    for (const cell of rowNode.content || []) {
      if (cell?.type === 'tableCell') {
        // Skip the empty SHOWN-lane placeholder paragraph (no words, no block) so a split row
        // doesn't leak a phantom empty bin block; keep everything else verbatim.
        for (const blk of cell.content || []) {
          if (blk?.type === 'tableRow') { flattenRow(blk, `${rowPairId}_n${nestedIndex++}`); continue; }
          if (isEmptyPlaceholderPara(blk)) continue;
          const lane = !isPairedRow
            ? null
            : (cell.attrs?.role === 'said' ? 'said' : (cell.attrs?.role === 'shown' ? 'shown' : null));
          flat.push({
            node: blk,
            lane,
            pairId: isPairedRow ? rowPairId : null,
          });
        }
      } else flat.push({ node: cell, lane: null, pairId: null });
    }
  };
  for (let rowIndex = 0; rowIndex < doc.content.length; rowIndex++) {
    const node = doc.content[rowIndex];
    if (node?.type === 'tableRow') flattenRow(node, `pair_${rowIndex}`);
    else flat.push({ node, lane: null, pairId: null });
  }
  flat.forEach(({ node, lane, pairId }, i) => {
    // scriptStart is a decorative divider — no source content, no block.
    if (node.type === 'scriptStart') return;
    const block = nodeToBlock(node, i);
    if (lane && pairId) {
      block.lane = lane;
      block.pairId = pairId;
    }
    out.push(block);
  });
  return out;
}

function nodeToBlock(node, i) {
  const a = node.attrs || {};
  const id = a.blockId || `blk_${i}`;
  const text = nodeText(node);
  let type = NODE_TO_TYPE[node.type];
  if (node.type === 'noteBlock') type = a.kind || 'note';
  const block = { id, type: type || 'bin' };
  if (a.flavor) block.flavor = a.flavor;
  // Emit ONLY when set (like flavor) so an unstamped doc's blocks array stays byte-identical.
  if (a.pendingViz) block.pendingViz = true;
  if (node.type === 'chapterBlock') { block.title = text; block.genre = a.genre; }
  else if (node.type === 'sceneBlock') { block.title = text; }
  else if (node.type === 'sotBlock' || node.type === 'brollBlock') {
    block.text = text;
    block.timecode = { tc: a.timecode || '', day: a.day ?? null, ambiguous: !!a.ambiguous, raw: a.rawTimecode || a.timecode || '' };
    // OUT/range-end code only present when set (keep the block shape minimal otherwise).
    if (a.tcOut) block.timecode.tcOut = a.tcOut;
    if (a.speaker) block.speaker = a.speaker;
    block.done = !!a.done;
  } else if (node.type === 'voBlock') { block.text = text; block.voStatus = a.status || 'todo'; }
  else if (node.type === 'imageBlock') {
    // Image blocks are attr-complete atoms: src / caption / kind round-trip via attrs, no text.
    block.imageSrc = a.src || '';
    block.imageAlt = a.alt || '';
    block.imageKind = a.kind === 'inspo' ? 'inspo' : 'shot';
    // Emit width/crop ONLY when set → an untouched image block serializes byte-identical.
    if (Number.isFinite(a.width)) block.imageWidth = a.width;
    if (imageCropShapeOk(a.crop)) block.imageCrop = a.crop;
  }
  else { block.text = text; }
  return block;
}
