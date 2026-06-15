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
    const isTk = tok[0] === '{';
    out.push({
      type: 'text',
      text: tok,
      marks: [{ type: isTk ? 'tkSpan' : 'visualSpan' }],
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
function blockToNode(b) {
  const id = b.id;
  switch (b.type) {
    case 'chapter':
      return {
        type: 'chapterBlock',
        attrs: { blockId: id, genre: b.genre || 'other' },
        content: [para([{ type: 'text', text: clean(b.title) || 'Chapter' }])],
      };

    case 'scene':
      return {
        type: 'sceneBlock',
        attrs: { blockId: id },
        content: [para([{ type: 'text', text: clean(b.title) || 'Scene' }])],
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
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
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
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
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
        attrs: { blockId: id },
        content: [para([{ type: 'text', text: clean(b.text) || ' ' }])],
      };
  }
}

export function buildEditorDocument(blocks) {
  const content = (blocks || [])
    .filter(Boolean)
    .map(blockToNode)
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
      const span = marks.find((m) => m.type === 'tkSpan' || m.type === 'visualSpan');
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
