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

// Worklists are READ-ONLY handoff views — no round-trip back to blocks — so we can safely
// unwrap the inline span scaffolding for display. nodeText/wrapToken re-wrap the marked
// spans into literal '{tk …}' / '[visual …]' tokens so the live doc round-trips; but a
// producer reading a checklist shouldn't see that markup. Strip the braces/brackets and
// keep the inner text. This is the INVERSE of inlineContent/wrapToken above — keep the two
// in sync (guarded by the worklist-unwrap checks in integrity-check.ts).
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
  const m = String(tc).trim().match(/(\d{1,2}:\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : String(tc).trim();
}

// ---- inline span splitting ----------------------------------------------
// VO/ONCAM prose carries inline {TK research} and [visual] direction. We split the
// text into TipTap text nodes, marking the spans so the editor can render the Swiss-red
// underline workshop affordance. Works off literal {…}/[…] in the cleaned text so it
// survives editing (the schema offsets would drift once the user types).
// Any broadcast timecode anywhere in the prose: HH:MM:SS:FF or H:MM:SS:FF. Matches the
// audit's detector (\b\d{1,2}:\d{2}:\d{2}:\d{2}\b). EVERY one becomes a clickable copy-chip.
const TIMECODE_RE = /\b\d{1,2}:\d{2}:\d{2}:\d{2}\b/;
const TIMECODE_RE_G = /\b\d{1,2}:\d{2}:\d{2}:\d{2}\b/g;

// Push `text` onto `out` as TipTap text nodes, splitting out EVERY embedded timecode into its
// own node carrying the 'timecode' mark (a clickable copy-chip) — ON TOP of any base marks the
// surrounding span supplies. This is what tags timecodes nested INSIDE a {tk …}/[visual …] span
// (e.g. "[B roll of hotels on DAY 2 00:09:19:03]") as well as in bare prose. baseMarks may be
// undefined (bare prose) or a span mark array.
function pushTextWithTimecodes(out, text, baseMarks) {
  if (!text) return;
  let last = 0, m;
  TIMECODE_RE_G.lastIndex = 0;
  while ((m = TIMECODE_RE_G.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index), ...(baseMarks ? { marks: baseMarks } : {}) });
    const tcMark = { type: 'timecode', attrs: { tc: m[0] } };
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

function inlineContent(rawText, type) {
  const text = stripLead(rawText, type);
  if (!text) return [{ type: 'text', text: ' ' }];

  const out = [];
  // Combined splitter: {tk …}/{fc …} brace tokens, [visual] brackets, AND every embedded
  // broadcast timecode. Order in the alternation lets a timecode INSIDE a {tk …} stay part
  // of the brace token (the brace alternative wins because it starts earlier / is matched
  // first at that index). Standalone timecodes in plain prose get their own chip.
  const re = /(\{[^{}]*\}|\[[^\[\]]*\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    // Plain prose between spans — split out any bare timecodes as their own copy-chips.
    if (m.index > last) pushTextWithTimecodes(out, text.slice(last, m.index));
    const tok = m[0];

    const isBrace = tok[0] === '{';
    // A {…} brace token is EITHER a fact-check ask ({fc …}/{fact …}) or a {tk …} writing
    // ask. Sniff the keyword to route to the right mark — the two are visually distinct and
    // open the Workshop hub in different modes (fc → verify; tk → 5 options).
    const isFc = isBrace && /^\{\s*(?:fc|fact)\b/i.test(tok);
    const markType = isBrace ? (isFc ? 'factCheckSpan' : 'tkSpan') : 'visualSpan';
    // Strip only the STRUCTURAL braces/brackets — KEEP the leading keyword ("tk"/"fc") in the
    // visible chip text, matching the CARTRIDGES reference ("tk fractured-shape", "tk ~one
    // fifth"). This is also the integrity-correct behaviour: the keyword is a real word in the
    // original script, so keeping it means no words are dropped (the audit sees every word).
    // nodeText.wrapToken is keyword-aware so the export round-trip stays single-keyword.
    const inner = isBrace
      ? tok.replace(/^\{\s*/, '').replace(/\}$/, '').trim()
      : tok.replace(/^\[\s*/, '').replace(/\]$/, '').trim();
    // Emit the span — but a timecode embedded INSIDE the span ("[… DAY 2 00:09:19:03]") gets
    // BOTH the span mark AND a timecode chip mark, so every timecode is clickable/copyable.
    const spanMark = { type: markType };
    if (TIMECODE_RE.test(inner)) {
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
const ACT_HEAD = /^(COLD\s*OPEN|HISTORY|GROUND|INQUIRY|LATM|ACT|EPILOGUE|OUTRO|TEASER|INTRO)\b/i;
const DIRECTION_WORDS = /\b(ON[\s-]?CAM|MONOLOGUE|WALK\s*AND\s*TALK|WALK\s*&\s*TALK|VOICEOVER|\bVO\b|PIECE\s*TO\s*CAMERA|PTC|SEQUENCE|MAP\b)/i;

// Trim a divider title down to its clean act label, dropping any directing tail the parser
// glued on ("HISTORY 2 BRITISH x walk and talk" → "HISTORY 2"). Keeps the dark cartridge
// reading as a crisp section marker. The tail is NOT lost — chapterBody() emits it as a
// paragraph under the heading (integrity fix: the chapter's body text reaches the page).
function actLabel(title) {
  let t = clean(title).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(COLD\s*OPEN|HISTORY|GROUND|INQUIRY|LATM|ACT|EPILOGUE|OUTRO|TEASER|INTRO)(\s*\d+)?/i);
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
function headBodySplit(rawTitle, headLabel) {
  let t = clean(rawTitle).replace(/\s+/g, ' ').trim();
  // Peel the structural section markers the parser kept ("CH:", "⁃ SCENE:", "SCENE").
  t = t.replace(/^[⁃•‣·\s-]*CH\s*[:.]?\s*/i, '').replace(/^[⁃•‣·\s-]*SCENE\s*[:.]?\s*/i, '').trim();
  const head = clean(headLabel).replace(/\s+/g, ' ').trim();
  let body = t;
  // Try to peel the recognized act head (e.g. "HISTORY 2") off the front.
  const m = t.match(/^(COLD\s*OPEN|HISTORY|GROUND|INQUIRY|LATM|ACT|EPILOGUE|OUTRO|TEASER|INTRO)(\s*\d+)?\s*[.:–—-]?\s*/i);
  if (m) body = t.slice(m[0].length).trim();
  else if (head && t.toUpperCase().startsWith(head.toUpperCase())) body = t.slice(head.length).replace(/^\s*[.:–—-]\s*/, '').trim();
  return body;
}

// Decide what a parser-labelled `chapter` REALLY is.
//   'chapter' → keep (true act divider; title will be clamped to the act label)
//   'oncam'   → demote (it's narration / a directed on-cam beat, not a section)
function reclassifyChapter(b) {
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
  const id = b.id;
  // Reclassify over-eager CHAPTER labels BEFORE the switch so demoted ones flow into the
  // right node branch (oncam / scene) and pick up colour instead of a dark divider bar.
  if (b.type === 'chapter') {
    const real = reclassifyChapter(b);
    if (real === 'oncam') b = { ...b, type: 'oncam', text: b.text || b.title };
    else if (real === 'scene') b = { ...b, type: 'scene', title: b.title };
  }
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
      return {
        type: 'sotBlock',
        attrs: {
          blockId: id,
          timecode: formatTimecode(b.timecode?.tc),
          rawTimecode: b.timecode?.raw || b.timecode?.tc || '',
          day: b.timecode?.day ?? null,
          ambiguous: !!b.timecode?.ambiguous,
          speaker: b.speaker || '',
          done: !!b.done,
        },
        content: [para(inlineContent(cleanQuote(bodyText(b)), 'plain'))],
      };

    case 'broll':
      return {
        type: 'brollBlock',
        attrs: {
          blockId: id,
          timecode: formatTimecode(b.timecode?.tc),
          rawTimecode: b.timecode?.raw || b.timecode?.tc || '',
          day: b.timecode?.day ?? null,
          ambiguous: !!b.timecode?.ambiguous,
          done: !!b.done,
        },
        content: [para(inlineContent(cleanQuote(bodyText(b)), 'plain'))],
      };

    case 'map-need':
    case 'archive-req':
      return {
        type: 'serviceBlock',
        attrs: { blockId: id, kind: b.type, label: b.title || (b.type === 'map-need' ? 'Mapping data needs' : 'Archive request') },
        // Route through inlineContent so {tk}/[visual] markers baked into the raw text become
        // clickable chips that reach the Workshop hub — every marker is a chip (punch-list #6).
        content: [para(inlineContent(bodyText(b), 'plain'))],
      };

    case 'note':
    case 'jh-note':
      return {
        type: 'noteBlock',
        attrs: { blockId: id, kind: b.type },
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

export function buildEditorDocument(blocks) {
  const list = (blocks || []).filter(Boolean);
  // Everything before the first chapter is pre-script author scaffolding. Flag the
  // leading BIN notes so the FIELD NOTE opens calm (masthead → CH 01), not on setup text.
  const firstChapter = list.findIndex((b) => b.type === 'chapter');
  const content = list
    .map((b, i) => blockToNode(b, { scaffold: b.type === 'bin' && firstChapter > 0 && i < firstChapter }))
    .filter(Boolean);
  // ProseMirror requires at least one child.
  if (!content.length) content.push({ type: 'binBlock', attrs: { blockId: 'empty' }, content: [para([{ type: 'text', text: ' ' }])] });
  return { type: 'doc', content };
}

// ---- read the live doc back to a blocks array (for persistence) ----------
const NODE_TO_TYPE = {
  chapterBlock: 'chapter',
  sceneBlock: 'scene',
  voBlock: 'vo',
  oncamBlock: 'oncam',
  sotBlock: 'sot',
  brollBlock: 'broll',
  serviceBlock: null, // kind held in attrs
  noteBlock: null,
  binBlock: 'bin',
};

// Tree-walk a node to its plain text, RE-SERIALIZING the inline span marks back into
// their {tk …}/[…] tokens. Two cases must round-trip:
//   (a) seed + bubble-menu spans already carry literal braces inside the marked text →
//       we must NOT double-wrap them.
//   (b) a mark applied to bare text (e.g. via an input rule on a fragment, or a future
//       command that marks without braces) → we wrap it so the blocks export stays
//       faithful (low-priority round-trip fix). The doc JSON remains canonical; this
//       keeps docToBlocks() a faithful derived/export view.
function wrapToken(text, kind) {
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
  return t;
}

export function nodeText(node) {
  let s = '';
  (function walk(n) {
    if (n.text) {
      let piece = n.text;
      const marks = n.marks || [];
      const span = marks.find((m) => m.type === 'tkSpan' || m.type === 'factCheckSpan' || m.type === 'visualSpan');
      if (span) piece = wrapToken(piece, span.type);
      s += piece;
    }
    if (n.content) n.content.forEach(walk);
  })(node);
  return s.trim();
}

export function docToBlocks(doc) {
  if (!doc?.content) return [];
  return doc.content.map((node, i) => {
    const a = node.attrs || {};
    const id = a.blockId || `blk_${i}`;
    const text = nodeText(node);
    let type = NODE_TO_TYPE[node.type];
    if (node.type === 'serviceBlock') type = a.kind || 'map-need';
    if (node.type === 'noteBlock') type = a.kind || 'note';
    const block = { id, type: type || 'bin' };
    if (node.type === 'chapterBlock') { block.title = text; block.genre = a.genre; }
    else if (node.type === 'sceneBlock') { block.title = text; }
    else if (node.type === 'sotBlock' || node.type === 'brollBlock') {
      block.text = text;
      block.timecode = { tc: a.timecode || '', day: a.day ?? null, ambiguous: !!a.ambiguous, raw: a.rawTimecode || a.timecode || '' };
      if (a.speaker) block.speaker = a.speaker;
      block.done = !!a.done;
    } else if (node.type === 'voBlock') { block.text = text; block.voStatus = a.status || 'todo'; }
    else { block.text = text; }
    return block;
  });
}
