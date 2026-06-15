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
// The parser left markdown-escape backslashes in the raw text (\-, \[, \], \!).
// Strip them so the script reads clean. Also collapses the leading "VO:" / "-VO:"
// type prefixes that the parser kept inside .text for some blocks.
function clean(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\([\-\[\]\!\(\)\.\*_`#>~])/g, '$1') // unescape markdown escapes
    .replace(/⁠/g, '')                          // word-joiner noise
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Strip a leading speaker/role prefix the parser embedded in prose, e.g.
// "-VO: text" / "VO: text" / "DAY 2 JH ON CAM 02:.. :". Keeps the meaningful body.
function stripLead(text, type) {
  let t = clean(text);
  if (type === 'vo') t = t.replace(/^[-‐‑‒–—\s]*VO:\s*/i, '');
  if (type === 'oncam') t = t.replace(/^DAY\s*\d+\s*/i, '').replace(/\bON\s*CAM\b/i, 'On camera —');
  return t.trim();
}

// SOT/broll transcript prose arrives with parser leftovers: a leading bullet dash, an
// inline "SOT:" / "Day N SOT:" / "string out" label, and a stray timecode echo (the
// timecode already lives in the HERO head). Strip those so the quote reads clean — the
// hero datum stays in attrs, the body is just the words. Keeps export faithful (the
// timecode round-trips from attrs, not from the prose).
export function cleanQuote(text) {
  let t = clean(text);
  // Normalise the U+2043 hyphen-bullet (and friends) the parser used as item separators
  // to a clean spaced en-dash so the transcript reads as connected prose, not a bullet wall.
  t = t.replace(/[⁃•]/g, '–');
  // Drop a leading separator, then peel off the "SCENE …" / "SOT: Day N string out" /
  // "DAY N SOT:" lead-in labels and any echoed timecode (the timecode is the HERO in attrs).
  t = t.replace(/^[\s–-]+/, '');
  t = t.replace(/^SCENE\b[^–]*–\s*/i, '');                  // "SCENE Breakfast … –"
  t = t.replace(/^SOT:\s*Day\s*\d+\s*string\s*out\s*–?\s*/i, ''); // "SOT: Day 1 string out –"
  t = t.replace(/^DAY\s*\d+\s*SOT\s*[:.-]?\s*/i, '');       // "DAY 1 SOT:"
  t = t.replace(/^SOT\s*[:.-]\s*/i, '');                    // "SOT:"
  t = t.replace(/^\d{1,2}:\d{2}:\d{2}:\d{2}\s*–?\s*/, '');  // leading echoed timecode
  // Re-strip leading separators: a bullet often sits AFTER the label/timecode we just
  // peeled (e.g. "DAY 1 SOT: 02:… – ⁃ quote"), so the first pass at the top can't catch
  // it. Run the leading-separator strip again now that the lead-ins are gone.
  t = t.replace(/^[\s–—-]+/, '');
  t = t.replace(/\s+–\s+/g, ' — ');                         // tidy inner separators to em-dash
  return t.trim();
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
function inlineContent(rawText, type) {
  const text = stripLead(rawText, type);
  if (!text) return [{ type: 'text', text: ' ' }];

  const out = [];
  // matches {tk ...} or [visual ...]; non-greedy, no nesting
  const re = /(\{[^{}]*\}|\[[^\[\]]*\])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    const tok = m[0];
    const isBrace = tok[0] === '{';
    // A {…} brace token is EITHER a fact-check ask ({fc …}/{fact …}) or a {tk …} writing
    // ask. Sniff the keyword to route to the right mark — the two are visually distinct and
    // open the Workshop hub in different modes (fc → verify; tk → 5 options).
    const isFc = isBrace && /^\{\s*(?:fc|fact)\b/i.test(tok);
    const markType = isBrace ? (isFc ? 'factCheckSpan' : 'tkSpan') : 'visualSpan';
    // Strip the STRUCTURAL braces + the leading keyword from the VISIBLE text so the script
    // reads clean (correction #10) — no bright "{tk"/"{fc" curly noise mid-sentence. The
    // mark still carries the span; nodeText.wrapToken re-adds the token on export so the
    // blocks round-trip stays faithful.
    const inner = isBrace
      ? tok.replace(/^\{\s*(?:tk|fc|fact)\b[:\s]*/i, '').replace(/^\{\s*/, '').replace(/\}$/, '').trim()
      : tok.replace(/^\[\s*/, '').replace(/\]$/, '').trim();
    out.push({
      type: 'text',
      text: inner || tok,
      marks: [{ type: markType }],
    });
    last = m.index + tok.length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.length ? out : [{ type: 'text', text: ' ' }];
}

function para(content) {
  return { type: 'paragraph', content: content && content.length ? content : undefined };
}

// ---- per-block -> node ---------------------------------------------------
// `opts.scaffold` marks a leading BIN block that sits BEFORE the first chapter — author
// setup notes ("read this only after…", "this is the actual script…"). They are real data
// (kept, editable, round-tripping), but the script must OPEN on the masthead then CH 01, not
// on instructions-to-self. We tag them so the BIN node renders a quiet collapsed strip.
function blockToNode(b, opts) {
  const id = b.id;
  switch (b.type) {
    case 'chapter':
      return {
        type: 'chapterBlock',
        attrs: { blockId: id, genre: b.genre || 'other' },
        content: [para([{ type: 'text', text: headingClause(b.title, 64) || 'Chapter' }])],
      };

    case 'scene':
      return {
        type: 'sceneBlock',
        attrs: { blockId: id },
        content: [para([{ type: 'text', text: headingClause(b.title, 80) || 'Scene' }])],
      };

    case 'vo':
      return {
        type: 'voBlock',
        attrs: { blockId: id, status: b.voStatus || 'todo' },
        content: [para(inlineContent(b.text, 'vo'))],
      };

    case 'oncam':
      return {
        type: 'oncamBlock',
        attrs: { blockId: id },
        content: [para(inlineContent(b.text, 'oncam'))],
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
        content: [para(inlineContent(cleanQuote(b.text), 'plain'))],
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
        content: [para(inlineContent(cleanQuote(b.text), 'plain'))],
      };

    case 'map-need':
    case 'archive-req':
      return {
        type: 'serviceBlock',
        attrs: { blockId: id, kind: b.type, label: b.title || (b.type === 'map-need' ? 'Mapping data needs' : 'Archive request') },
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
      };

    case 'note':
    case 'jh-note':
      return {
        type: 'noteBlock',
        attrs: { blockId: id, kind: b.type },
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
      };

    case 'bin':
    default:
      return {
        type: 'binBlock',
        attrs: { blockId: id, scaffold: !!(opts && opts.scaffold) },
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
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
    return '{tk ' + t.replace(/^\s+|\s+$/g, '') + '}';
  }
  if (kind === 'factCheckSpan') {
    if (/^\{.*\}$/s.test(t.trim())) return t;        // already braced
    return '{fc ' + t.replace(/^\s+|\s+$/g, '') + '}';
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
