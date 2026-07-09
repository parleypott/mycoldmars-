import { Extension, nodeInputRule } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { TextSelection } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';
import { episodeFlag } from '../episode-config.js';
import { mintUserPairId, insertBookmark } from './table.js';
import { insertFcFootnote } from './footnote.js';

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Set the directionMark on the current cursor position (empty selection).
// Deletes the slash-command range first so "/archive" text is removed, then
// stores the mark as a ProseMirror stored mark — the NEXT typed characters inherit it.
// With inclusive:true on the mark, typing continues to carry the highlight.
function setDirectionMark(editor, range, kind, seedText) {
  const attrs = defaultDirectionMarkAttrs(kind);
  const chain = editor
    .chain()
    .focus()
    .deleteRange(range)
    .setMark('directionMark', attrs);
  // SEED TEXT (Johnny: "/3d should automatically start with this state") — some kinds open
  // with their keyword already typed INSIDE the chip (e.g. "3D "), caret after it, so he
  // types straight into the highlight. The seed carries the mark explicitly (identical to
  // having typed it), and inclusive:true keeps the following keystrokes in the chip.
  if (seedText) chain.insertContent({ type: 'text', text: seedText, marks: [{ type: 'directionMark', attrs }] });
  return chain.run();
}

// archiveOwnLine flag (Palau opts in): /archive pops onto its OWN small-indented line. We delete
// the "/archive" text, split the current textblock so the archive starts a fresh paragraph, then
// store the mark so the next typed characters carry the red highlight. The paragraph-indent visual
// is applied by the checkbox plugin's node decoration (leading-archive → .wp-archive-line), gated
// on the same flag there too. In Burma the behavior is unchanged — archive stays an inline mark on
// the current line.
function setArchiveMark(editor, range) {
  const attrs = defaultDirectionMarkAttrs('archive');
  const isPalau = episodeFlag('archiveOwnLine');
  if (!isPalau) {
    return editor.chain().focus().deleteRange(range).setMark('directionMark', attrs).run();
  }
  return editor
    .chain()
    .focus()
    .deleteRange(range)
    .splitBlock()
    .setMark('directionMark', attrs)
    .run();
}

// ---------------------------------------------------------------------------
// STRUCTURE INSERTS — /chapter and /scene. Unlike every other slash command (inline
// directionMark kinds), these insert a real BLOCK-LEVEL node: an empty chapterBlock /
// sceneBlock, built with EXACTLY the shape buildEditorDocument emits (document-builder.js
// blockToNode → fullWidthRow) so the inserted node round-trips the migrate-doc mirror
// schema + docToBlocks with zero loss:
//   tableRow(cols:1) > tableCell(role:'full') > chapterBlock/sceneBlock > paragraph
//
// DEFAULT GENRE — a fresh /chapter is born with genre:'other' (the chapterBlock schema
// default). 'other' maps to an EMPTY act tag (ACT_TAG.other = ''), so the new chapter
// renders as a calm untagged book-header, ready for a title; and reclassifyChapter keeps
// an untitled 'other' chapter a chapter on every rebuild. Episode genres (HISTORY/GROUND/…)
// are episode-specific, so any non-'other' guess would be wrong for some script.
//
// DEPTH — mirrors doAddRowsBelow (table.js): the new row is inserted as a SIBLING of the
// row that owns the cursor, at WHATEVER depth that row lives (Palau's saved docs nest
// said|shown rows inside a wrapper row's cell). The insert is schema-checked; an
// impossible parent returns false instead of throwing mid-transaction.
//
// pairu_ pairId — the wrapping row is stamped with a user-added pairId (mintUserPairId)
// for the same reason add-rows stamps its rows: Palau's load-normalizer culls word-less
// rows, and a just-inserted EMPTY chapter/scene must survive the next load until the
// author types its title. On a cols:1 row the pairId never pairs anything (docToBlocks
// only reads pairIds on cols:2 rows) — it is purely the keep-me marker.
export const DEFAULT_CHAPTER_GENRE = 'other';

function mintBlockId() {
  return 'blk_' + Math.random().toString(36).slice(2, 9);
}

// Pure (state, dispatch, range, typeName, opts) -> boolean, like doAddRowsBelow — ONE ProseMirror
// transaction that deletes the "/chapter" trigger text AND inserts the new block, so a single
// undo removes both and autosave/backup fire exactly once. Exported for the headless suite.
//
// opts.withSubtitle — the /section shape: a chapterBlock born with TWO paragraphs, title +
// subtitle. Under the chapter-frames doctrine the FIRST paragraph renders as the big book-chapter
// serif ("GROUND 1") and every following paragraph as the quiet italic subtext ("Yongon - Arrival
// and lay of the land") — so /section inserts that full header, ready to type into, where
// /chapter only mints the bare one-line title slot.
export function doInsertStructureBlock(state, dispatch, range, typeName, opts = {}) {
  const { schema } = state;
  const blockType = schema.nodes[typeName];
  if (!blockType) return false;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;

  const max = state.doc.content.size;
  const from = Math.max(0, Math.min(range?.from ?? 0, max));
  const to = Math.max(from, Math.min(range?.to ?? from, max));

  const tr = state.tr;
  tr.delete(from, to);

  const attrs = { blockId: mintBlockId() };
  if (typeName === 'chapterBlock') attrs.genre = DEFAULT_CHAPTER_GENRE;
  // createAndFill satisfies the '(paragraph | bulletList | orderedList)+' content spec with
  // one empty paragraph — the same "heading paragraph" slot blockToNode builds, just untyped.
  // withSubtitle builds the two-slot /section shape explicitly (title + subtitle paragraphs).
  const paraType = schema.nodes.paragraph;
  const block = (opts.withSubtitle && paraType)
    ? blockType.create(attrs, [paraType.create(), paraType.create()])
    : blockType.createAndFill(attrs);
  if (!block) return false;

  // Resolve the (post-delete) cursor spot and walk up to the OUTERMOST tableRow ancestor.
  // Chapters/scenes are TOP-LEVEL structure: the chapter-frames decorator and the outline
  // both walk only the doc's top-level rows, so a chapter inserted as a sibling of a NESTED
  // row (a shape drag ops can produce) rendered as a frameless orphan cartridge — Johnny's
  // "chapter still looks like this" bug. Inserting beside the outermost row guarantees the
  // new chapter opens its big frame and appears in the outline, whatever the cursor depth.
  const $pos = tr.doc.resolve(Math.min(from, tr.doc.content.size));
  let rowDepth = 0;
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'tableRow') { rowDepth = d; break; }
  }

  let insertAt;
  if (rowDepth > 0 && rowType && cellType) {
    // TABLE-SPINE doc (every live doc) — wrap exactly like document-builder's fullWidthRow.
    const newRow = rowType.create(
      { cols: 1, pairId: mintUserPairId() },
      cellType.create({ role: 'full' }, block),
    );
    const rowPos = $pos.before(rowDepth);
    const rowNode = tr.doc.nodeAt(rowPos);
    if (!rowNode) return false;
    const $row = tr.doc.resolve(rowPos);
    const index = $row.index($row.depth);

    // EMPTY-HOST REPLACE: the common gesture is typing "/chapter" on a fresh empty line.
    // After the trigger delete, if the host row is a full-width row holding exactly ONE
    // prose block with NO words left, the chapter/scene REPLACES that row — otherwise the
    // writer would be left with a stray empty block above every chapter they insert.
    // Atom blocks (images) carry no text but are visible content, so they never qualify.
    const lone = rowNode.childCount === 1 && rowNode.child(0).childCount === 1
      ? rowNode.child(0).child(0)
      : null;
    const emptyHost = !!lone && !lone.isAtom && !lone.textContent.trim();

    if (emptyHost) {
      if (!$row.parent.canReplaceWith(index, index + 1, rowType)) return false;
      insertAt = rowPos;
      tr.replaceWith(rowPos, rowPos + rowNode.nodeSize, newRow);
    } else {
      if (!$row.parent.canReplaceWith(index + 1, index + 1, rowType)) return false;
      insertAt = rowPos + rowNode.nodeSize;
      tr.insert(insertAt, newRow);
    }
  } else {
    // Bare (pre-table) doc — insert the block itself after the top-level block that owns
    // the cursor. ensureTableDoc wraps it into a row on the next load, exactly like any
    // other pre-table block.
    const after = $pos.depth > 0 ? $pos.after(1) : Math.min($pos.pos, tr.doc.content.size);
    const index = tr.doc.resolve(after).index(0);
    if (!tr.doc.canReplaceWith(index, index, blockType)) return false;
    insertAt = after;
    tr.insert(after, block);
  }

  // Cursor into the new block's title/text — the first text position inside the insert.
  try {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1), 1));
  } catch {}
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

// ---------------------------------------------------------------------------
// /vo — VO CONVERSION. Unlike the structure inserts, /vo converts the block the cursor
// already lives in INTO a voBlock — the writer types a line, hits /vo, and the text keeps
// its clean serif body while the block picks up the small "VO" corner tag (blocks.js paints
// it in chip chrome). Only the plain prose carts convert; blocks carrying structure or
// producer data (chapter / scene / SOT / broll / image) are left untouched — the trigger
// text is still removed so a stray "/vo" never lands in the script. Same one-transaction
// law as the structure inserts: trigger delete + retype in a single undo step.
export const VO_CONVERTIBLE = ['noneBlock', 'binBlock', 'oncamBlock', 'montageBlock'];

// Retype whatever hosts `pos` into a voBlock, INSIDE an existing transaction. Two shapes:
//   (a) CART HOST — the cursor lives in a convertible prose cart (VO_CONVERTIBLE). All four
//       share voBlock's exact content spec + marks allowlist, so setNodeMarkup is always
//       schema-valid. blockId survives (or is minted) so autosave/recovery keys stay stable.
//   (b) BARE CELL PARAGRAPH — the common LEFT-COLUMN case: a said|shown cell's "+"-added row
//       opens with a bare paragraph directly inside the tableCell (no cart wrapper at all),
//       so the ancestor walk finds nothing to retype. The paragraph is WRAPPED into a fresh
//       voBlock instead (tableCell content is 'block+', so the replace is schema-valid).
// Returns true if the host is (or became) a voBlock. Exported for the headless suite and
// shared by /vo and the right-click convert menu.
export function retypeHostToVo(tr, schema, pos) {
  const voType = schema.nodes.voBlock;
  if (!voType) return false;
  const $pos = tr.doc.resolve(Math.max(0, Math.min(pos, tr.doc.content.size)));

  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === 'voBlock') return true; // already VO — nothing to retype
    if (VO_CONVERTIBLE.includes(node.type.name)) {
      tr.setNodeMarkup($pos.before(d), voType, {
        blockId: node.attrs.blockId || mintBlockId(),
        flavor: node.attrs.flavor ?? null,
        chapterId: node.attrs.chapterId ?? null,
        status: 'todo',
      });
      return true;
    }
  }

  // (b) bare cell paragraph — wrap it. Selection is re-placed at the same text spot (+1 for
  // the voBlock open token) so the caret never visibly moves.
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const parent = $pos.node(d - 1);
    if (node.type.name === 'paragraph' && parent && parent.type.name === 'tableCell') {
      const start = $pos.before(d);
      const block = voType.create(
        { blockId: mintBlockId(), flavor: null, chapterId: null, status: 'todo' },
        node,
      );
      tr.replaceWith(start, start + node.nodeSize, block);
      try {
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size)), 1));
      } catch {}
      return true;
    }
  }
  return false;
}

export function doConvertBlockToVo(state, dispatch, range) {
  if (!state.schema.nodes.voBlock) return false;

  const max = state.doc.content.size;
  const from = Math.max(0, Math.min(range?.from ?? 0, max));
  const to = Math.max(from, Math.min(range?.to ?? from, max));

  const tr = state.tr;
  tr.delete(from, to);
  retypeHostToVo(tr, state.schema, Math.min(from, tr.doc.content.size));
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

// /bullet + /number — delete the slash trigger then toggle the host block into a list. These are
// the discoverable, un-hijackable backups for Cmd/Ctrl+Shift+8 / +7 (a chord the OS steals can't
// be fixed in JS). One chain = one undo. toggleBulletList / toggleOrderedList are StarterKit
// RawCommands, always chainable. Read-mode gated (the slash plugin never mounts read-only, but
// keep the write path honest).
function toggleSlashList(editor, range, kind) {
  if (isReadOnly()) return false;
  const view = editor.view;
  if (!view || !view.editable) return false;
  const chain = editor.chain().focus().deleteRange(range);
  const done = kind === 'ordered' ? chain.toggleOrderedList().run() : chain.toggleBulletList().run();
  if (done) view.focus();
  return done;
}

function convertBlockToVo(editor, range) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = doConvertBlockToVo(state, view.dispatch, range);
  if (done) view.focus();
  return done;
}

function insertStructureBlock(editor, range, typeName, opts) {
  // READ-ONLY SHARE: the suggestion plugin never mounts in read-only, but gate the mutation
  // here too so no code path can ever insert a block into a reader's frozen doc.
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = doInsertStructureBlock(state, view.dispatch, range, typeName, opts);
  if (done) view.focus();
  return done;
}

function makeItem(title, aliases, run, opts) {
  const aliasList = aliases || [];
  const haystack = [title, ...aliasList].map((s) => String(s).toLowerCase());
  return {
    title,
    aliases: aliasList,
    run,
    // 'structure' items insert block-level nodes (chapter/scene); 'mark' items (the default)
    // apply inline directionMarks. The renderer groups the menu on this.
    group: opts?.group || 'mark',
    // small right-aligned hint glyph rendered in the menu row (e.g. CH / SC).
    hint: opts?.hint || '',
    match(query) {
      const q = String(query || '').trim().toLowerCase();
      if (!q) return true;
      return haystack.some((value) => value.startsWith(q));
    },
  };
}

export const SLASH_ITEMS = [
  // STRUCTURE — block-level inserts, grouped above the inline tag list.
  makeItem('chapter',   ['ch'],           (editor, range) => insertStructureBlock(editor, range, 'chapterBlock'), { group: 'structure', hint: 'CH' }),
  makeItem('scene',     ['sc'],           (editor, range) => insertStructureBlock(editor, range, 'sceneBlock'),   { group: 'structure', hint: 'SC' }),
  // /section — the full act header (Image-11 shape): big serif title + italic subtitle line,
  // i.e. a chapterBlock with BOTH paragraphs pre-built. Title it "GROUND 1" / "HISTORY 2" and the
  // genre tag reclassifies from the heading like any chapter.
  makeItem('section',   ['sec', 'header', 'title'], (editor, range) => insertStructureBlock(editor, range, 'chapterBlock', { withSubtitle: true }), { group: 'structure', hint: 'SEC' }),
  // /vo — retype the current prose block as VO narration: clean serif body + the small
  // "VO" corner tag. A conversion, not an insert — the writer's text stays put.
  makeItem('vo',        ['voice', 'narration', 'v.o.'], (editor, range) => convertBlockToVo(editor, range), { group: 'structure', hint: 'VO' }),
  // MARKS — the inline direction-mark kinds.
  makeItem('archive',   [],               (editor, range) => setArchiveMark(editor, range)),
  makeItem('oncam',     ['on cam', 'on cam to film'], (editor, range) => setDirectionMark(editor, range, 'oncam')),
  makeItem('factcheck', ['fc', 'source'], (editor, range) => setDirectionMark(editor, range, 'factcheck')),
  makeItem('footnote',  ['fn', 'note', 'todo'], (editor, range) => insertFcFootnote(editor, range), { hint: 'FN' }),
  makeItem('bookmark',  ['bm', 'mark', 'pin'], (editor, range) => insertBookmark(editor, range), { hint: 'BM' }),
  makeItem('animation', ['anim'],         (editor, range) => setDirectionMark(editor, range, 'animation')),
  makeItem('3d',        ['3d animation', 'threed'], (editor, range) => setDirectionMark(editor, range, '3d', '3D ')),
  makeItem('broll',     [],               (editor, range) => setDirectionMark(editor, range, 'broll')),
  makeItem('map-data',  ['map', 'mapdata', 'cartography', 'carto'], (editor, range) => setDirectionMark(editor, range, 'mapdata')),
  makeItem('direction', [],               (editor, range) => setDirectionMark(editor, range, 'direction')),
  makeItem('break',     [],               (editor, range) => editor.chain().focus().deleteRange(range).insertContent({ type: 'directionBreak' }).run()),
  // LIST TOGGLES — discoverable backups for Cmd/Ctrl+Shift+8 / +7.
  makeItem('bullet',    ['bullets', 'ul', 'list', 'unordered'], (editor, range) => toggleSlashList(editor, range, 'bullet'),  { hint: '•' }),
  makeItem('number',    ['numbered', 'ol', 'ordered', 'nums'],  (editor, range) => toggleSlashList(editor, range, 'ordered'), { hint: '1.' }),
];

function createSlashRenderer() {
  let menu = null;
  let items = [];
  let activeIndex = 0;
  let latestProps = null;

  const destroy = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    items = [];
    activeIndex = 0;
    latestProps = null;
  };

  const place = () => {
    if (!menu || !latestProps?.clientRect) return;
    const rect = latestProps.clientRect();
    if (!rect) return;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    const box = menu.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
    if (box.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, rect.top - box.height - 4)}px`;
  };

  const choose = (index) => {
    if (!latestProps) return;
    const item = items[index];
    if (!item) return;
    latestProps.command(item);
  };

  const render = (props) => {
    latestProps = props;
    items = Array.isArray(props.items) ? props.items : [];
    if (!items.length) {
      destroy();
      return;
    }
    if (!menu) {
      menu = el('div', 'wp-slash-menu', { contenteditable: 'false' });
      document.body.appendChild(menu);
    }
    if (activeIndex >= items.length) activeIndex = 0;
    menu.textContent = '';
    items.forEach((item, index) => {
      // GROUP CHROME — the 'structure' items (chapter/scene) sit above the inline tag list
      // under a small head, with one hairline divider before the marks. Both are computed off
      // the FILTERED items so a query that leaves only one group shows no stray head/divider.
      const group = item.group || 'mark';
      const prevGroup = index > 0 ? (items[index - 1].group || 'mark') : null;
      if (group !== prevGroup) {
        if (index > 0) menu.appendChild(el('div', 'wp-slash-sep'));
        if (group === 'structure') {
          const head = el('div', 'wp-slash-head');
          head.textContent = 'structure';
          menu.appendChild(head);
        }
      }
      const button = el('button', 'wp-slash-item' + (index === activeIndex ? ' is-active' : ''), {
        type: 'button',
      });
      button.textContent = item.title;
      if (item.hint) {
        const hint = el('span', 'wp-slash-hint');
        hint.textContent = item.hint;
        button.appendChild(hint);
      }
      button.addEventListener('mouseenter', () => {
        activeIndex = index;
        render(props);
      });
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeIndex = index;
        choose(index);
      });
      menu.appendChild(button);
    });
    place();
  };

  return {
    onStart(props) {
      if (isReadOnly()) return;
      activeIndex = 0;
      render(props);
    },
    onUpdate(props) {
      if (isReadOnly()) return;
      render(props);
    },
    onKeyDown(props) {
      if (!items.length) return false;
      if (props.event.key === 'ArrowDown') {
        props.event.preventDefault();
        activeIndex = (activeIndex + 1) % items.length;
        render(latestProps);
        return true;
      }
      if (props.event.key === 'ArrowUp') {
        props.event.preventDefault();
        activeIndex = (activeIndex - 1 + items.length) % items.length;
        render(latestProps);
        return true;
      }
      if (props.event.key === 'Enter') {
        props.event.preventDefault();
        choose(activeIndex);
        return true;
      }
      if (props.event.key === 'Escape') {
        props.event.preventDefault();
        destroy();
        return true;
      }
      return false;
    },
    onExit() {
      destroy();
    },
  };
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  addInputRules() {
    const directionBreak = this.editor.schema.nodes.directionBreak;
    if (!directionBreak) return [];
    return [nodeInputRule({ find: /^---$/, type: directionBreak })];
  },
  addProseMirrorPlugins() {
    if (isReadOnly()) return [];
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        allowedPrefixes: null,
        allowSpaces: false,
        allow: () => !isReadOnly(),
        // Pass both editor AND range to props.run so each item controls its own transaction.
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        items: ({ query }) => SLASH_ITEMS.filter((item) => item.match(query)),
        render: () => createSlashRenderer(),
      }),
    ];
  },
});
