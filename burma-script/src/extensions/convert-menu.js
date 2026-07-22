import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { episodeFlag } from '../episode-config.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';
import { retypeHostToVo, bulkRetypeToVo, laneMatches, maybeClearPendingForKindRange } from './slash-menu.js';
import { collectIntersectingRows, doDeleteRows, rowFirstBlockId } from './table.js';
import { findRowByIdentity } from './table.js';
import { convertTimecodesInRange } from './marks.js';

// ── SELECT → RIGHT-CLICK → BULK ROW MENU ─────────────────────────────────────────────────────────
// Highlight a run of text — anywhere from a few words to a span crossing many rows — right-click,
// and get one premium floating menu that does two jobs at once:
//
//   1. TAGS. Every role tag Johnny uses, each shown as its REAL chip (same colours the doc renders:
//      3d = purple + yellow, sot = red-purple italic, oncam = warm italic ink, …). Clicking a tag
//      bulk-applies it across the selection — but SCOPED TO THE COLUMN Johnny right-clicked in: a
//      said-lane click lays the tag only into said (+ full-width) cells, a shown-lane click only
//      into shown (+ full-width) cells; a full-width click has no lane preference and tags the whole
//      selection (Johnny 2026-07-21: "the tag should go into the column I right clicked"). One
//      transaction either way. VO is the one BLOCK action: it retypes every convertible block the
//      clicked lane touches into a voBlock (shared bulkRetypeToVo), the same conversion /vo runs.
//   2. UTILITIES. One compact hairline-separated row folding in the killed floating BubbleMenu's
//      survivors: TK ({tk} writing-helper span) and FC ({fc} fact-check span) as their real chips,
//      toggled with the bubble's exact set/unset semantics but lane-scoped like the role tags; and
//      the three paragraph-alignment tools as small square glyph buttons (exact TextAlign port).
//   3. DELETE. A destructive entry at the very bottom, hairline-separated, carrying a LIVE count of
//      the outermost rows the selection intersects — "DELETE 10 ROWS". Clicking removes those whole
//      top-level rows in one transaction (one undo restores everything). The count shown always
//      equals what actually gets deleted (both come from the same collectIntersectingRows snapshot).
//
// It NEVER hijacks right-click when the selection is empty — the timecode chip's own right-click
// sequence menu (marks.js) and the browser's native menu both stay intact. It also bails when the
// click lands on an existing chip, so order-of-plugin-registration can't let it steal the tc menu.
// Read-mode gated at every layer (the plugin doesn't even mount read-only). Gated on the
// `convertMenu` feature flag so an episode that hasn't opted in keeps its native right-click.

// The bulk tag list, in Johnny's stated order. label = the chip text the menu shows; kind = the
// directionMark kind (or '__vo', the one BLOCK action). Every MARK kind here is one
// defaultDirectionMarkAttrs already understands, so a bulk-applied run is byte-identical to a
// /-typed one. 'sot' is the interview-soundbite chip (red-purple italic) added in the 2026-07 pass.
export const VIZ_KINDS = [
  { label: 'VO',           kind: '__vo' },   // BLOCK action — retypes convertible blocks to voBlock
  { label: 'ON CAM',       kind: 'oncam' },
  { label: 'SOT',          kind: 'sot' },
  { label: '3D ANIMATION', kind: '3d' },
  { label: 'ANIMATION',    kind: 'animation' },
  { label: 'ARCHIVE',      kind: 'archive' },
  { label: 'B-ROLL',       kind: 'broll' },
  { label: 'MAP DATA',     kind: 'mapdata' },
  { label: 'FACT CHECK',   kind: 'factcheck' },
  { label: 'DIRECTION',    kind: 'direction' },
];

// ── UTILITY ROW — the BubbleMenu's survivors (Johnny 2026-07-21: the floating bubble "kind of
// gets in the way — get rid of it"). What survives, folded in here: the {tk} writing-helper span,
// the {fc} fact-check span, and the three paragraph-alignment tools ("really nice — keep").
// What did NOT survive: Bold/Italic (he uses hotkeys), VIS (killed — the visualSpan mark stays in
// the schema for existing docs, it just has no menu surface), MERGE/SPLIT (moved to the row's
// column-divider affordances, table.js).
export const UTILITY_SPANS = [
  { label: 'TK', mark: 'tkSpan', chipClass: 'wp-tk', title: 'Mark as {TK} writing helper' },
  { label: 'FC', mark: 'factCheckSpan', chipClass: 'wp-fc', title: 'Mark as {fc} fact-check' },
];
export const ALIGNMENTS = [
  { dir: 'left', glyph: '⇤', title: 'Align left' },
  { dir: 'center', glyph: '⇔', title: 'Align center' },
  { dir: 'right', glyph: '⇥', title: 'Align right' },
];

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// The role of the tableCell under the pointer at right-click time ('said' | 'shown' | 'full'), or
// null when the click resolves to no cell. Walks UP from the resolved doc position to the NEAREST
// enclosing tableCell, so a nested Palau row (wrapper cell > inner said|shown cells) reports the
// INNER leaf cell's own role — the lane the pointer is actually over — not the wrapper's 'full'.
// This is what scopes every bulk tag to the column Johnny right-clicked (2026-07-21).
function clickedCellRole(view, x, y) {
  const coords = view.posAtCoords({ left: x, top: y });
  if (!coords) return null;
  const size = view.state.doc.content.size;
  const $pos = view.state.doc.resolve(Math.max(0, Math.min(coords.pos, size)));
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'tableCell') return $pos.node(d).attrs?.role || 'full';
  }
  return null;
}

// The [from,to] sub-ranges of a selection that fall inside cells matching the clicked lane. Walks
// every LEAF tableCell (a cell holding no nested tableRow) intersecting the selection and keeps the
// intersection for cells whose role passes laneMatches. Wrapper cells (Palau's nested-row shape) are
// transparent — we descend through them to the inner said|shown cells and scope by THOSE, so lane
// scoping is recursion-safe. Each returned range is a cell's inner content clipped to [from,to].
function laneCellRanges(doc, from, to, clickedRole) {
  const ranges = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== 'tableCell') return true;
    let hasNestedRow = false;
    node.forEach((child) => { if (child.type.name === 'tableRow') hasNestedRow = true; });
    if (hasNestedRow) return true; // wrapper cell — descend to the leaf said|shown|full cells
    if (laneMatches(node.attrs?.role || 'full', clickedRole)) {
      const f = Math.max(from, pos + 1);
      const t = Math.min(to, pos + node.nodeSize - 1);
      if (t > f) ranges.push([f, t]);
    }
    return false; // leaf cell — nothing deeper to scope
  });
  return ranges;
}

// Apply the chosen viz kind across the clicked lane's slice of a specific [from,to] range, in ONE
// transaction (one undo). Uses the shared default-attrs helper so a bulk-applied run is byte-
// identical to one the slash menu would produce for that kind; setMark over a non-empty range is
// exactly tr.addMark(from,to,mark) (see the test's equivalence note), so we addMark each matching
// lane sub-range directly. `clickedRole` scopes which cells receive the tag (see laneMatches) — a
// said click never touches the shown column, and vice-versa. Passed the SNAPSHOT range captured
// when the menu opened (not the live selection) so what the chip preview promised is exactly what
// lands — a remote collab edit mid-menu can't retarget the apply. Pure (state, dispatch, …) ->
// boolean; exported for the headless suite.
export function bulkApplyMarkRange(state, dispatch, from, to, kind, clickedRole) {
  const markType = state.schema.marks.directionMark;
  if (!markType) return false;
  const size = state.doc.content.size;
  const lo = Math.max(0, Math.min(from, to, size));
  const hi = Math.max(0, Math.min(Math.max(from, to), size));
  if (lo === hi) return false; // never mark an empty selection
  const ranges = laneCellRanges(state.doc, lo, hi, clickedRole);
  if (!ranges.length) return false;
  const mark = markType.create(defaultDirectionMarkAttrs(kind));
  const tr = state.tr;
  for (const [f, t] of ranges) {
    tr.addMark(f, t, mark);
    // A visual tag IS the plan for every cell it lands on — lift the /pending red per matching lane
    // sub-range, in the SAME transaction (parity with setDirectionMark's single-cell clear). Scoped
    // to the tagged lane: a said-click clears pending only on the said/full cells it tagged; a
    // shown-lane pending stays red. The helper iterates cells and pendingViz is attr-only, so a
    // per-range call is position-safe.
    maybeClearPendingForKindRange(tr, kind, f, t);
  }
  if (dispatch) dispatch(tr);
  return true;
}

function applyMarkRange(editor, kind, from, to, clickedRole) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = bulkApplyMarkRange(state, view.dispatch, from, to, kind, clickedRole);
  if (done) view.focus();
  return done;
}

// Is every character of the lane-scoped ranges already wearing this mark? This is the SAME
// full-coverage rule TipTap's editor.isActive(markName) used to drive the bubble's TK/FC toggle
// state (partial coverage counted as inactive → clicking SET the mark; full coverage → UNSET),
// so the folded-in buttons keep the bubble's exact set/unset semantics. Pure, exported for the
// headless suite.
export function rangesFullyMarked(doc, ranges, markType) {
  let total = 0;
  let marked = 0;
  for (const [f, t] of ranges) {
    doc.nodesBetween(f, t, (node, pos) => {
      if (!node.isText) return true;
      const lo = Math.max(f, pos);
      const hi = Math.min(t, pos + node.nodeSize);
      if (hi <= lo) return false;
      total += hi - lo;
      if (markType.isInSet(node.marks)) marked += hi - lo;
      return false;
    });
  }
  return total > 0 && marked >= total;
}

// Toggle a tkSpan/factCheckSpan over the snapshot range — the bubble's applySpan/clearSpan pair
// (setMark/unsetMark: add the mark with its DEFAULT attrs preserving sibling marks, or strip it),
// now applied through the SAME laneCellRanges scoping as the role tags: a said-lane right-click
// marks only said(+full) cells, a shown click only shown(+full). One transaction, one undo.
// Pure (state, dispatch, …) -> boolean, exported for the headless suite.
export function bulkToggleSpanRange(state, dispatch, from, to, markName, clickedRole) {
  const markType = state.schema.marks[markName];
  if (!markType) return false;
  const size = state.doc.content.size;
  const lo = Math.max(0, Math.min(from, to, size));
  const hi = Math.max(0, Math.min(Math.max(from, to), size));
  if (lo === hi) return false; // never mark an empty selection
  const ranges = laneCellRanges(state.doc, lo, hi, clickedRole);
  if (!ranges.length) return false;
  const active = rangesFullyMarked(state.doc, ranges, markType);
  const tr = state.tr;
  if (active) {
    for (const [f, t] of ranges) tr.removeMark(f, t, markType);
  } else {
    const mark = markType.create(); // default attrs — byte-identical to what setMark stores
    for (const [f, t] of ranges) tr.addMark(f, t, mark);
  }
  if (dispatch) dispatch(tr);
  return true;
}

function applySpanRange(editor, markName, from, to, clickedRole) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = bulkToggleSpanRange(state, view.dispatch, from, to, markName, clickedRole);
  if (done) view.focus();
  return done;
}

// Set paragraph alignment across the snapshot range — the exact write the bubble's setTextAlign
// buttons made: TextAlign registers a `textAlign` attr on paragraph (Editor.jsx / migrate-doc's
// lockstep schema), and its command updates that attr on every paragraph the selection touches.
// Same here, over the SNAPSHOT range (a collab edit mid-menu can't retarget the write), one
// transaction. NOT lane-scoped: alignment is a paragraph-geometry tool, not a tag — the bubble
// aligned every paragraph in the selection and this keeps that behavior byte-identical.
// MEMORY TRAP honored: TextAlign stamps inline `text-align:left` on default paragraphs; the
// doctrine.css centered-chrome rules beat it with !important — we only write the attr the same
// way the extension did, so that fix is untouched. Pure, exported for the headless suite.
export function bulkSetTextAlignRange(state, dispatch, from, to, dir) {
  if (dir !== 'left' && dir !== 'center' && dir !== 'right') return false;
  const size = state.doc.content.size;
  const lo = Math.max(0, Math.min(from, to, size));
  const hi = Math.max(0, Math.min(Math.max(from, to), size));
  const tr = state.tr;
  let did = false;
  state.doc.nodesBetween(lo, hi, (node, pos) => {
    if (node.type.name !== 'paragraph') return true;
    if (node.attrs.textAlign !== dir) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign: dir });
      did = true;
    }
    return false; // paragraphs nest no paragraphs
  });
  if (!did) return false; // every paragraph already aligned this way → calm no-op, no autosave churn
  if (dispatch) dispatch(tr);
  return true;
}

// Do ALL paragraphs in the range carry this alignment? Drives the align buttons' pressed paint —
// the bubble's alignActive(dir) (editor.isActive({ textAlign: dir })) equivalent over a snapshot
// range. Pure, exported for the headless suite.
export function rangeAlignActive(doc, from, to, dir) {
  const size = doc.content.size;
  const lo = Math.max(0, Math.min(from, to, size));
  const hi = Math.max(0, Math.min(Math.max(from, to), size));
  let seen = 0;
  let matched = 0;
  doc.nodesBetween(lo, hi, (node) => {
    if (node.type.name !== 'paragraph') return true;
    seen++;
    if ((node.attrs.textAlign || 'left') === dir) matched++;
    return false;
  });
  return seen > 0 && matched === seen;
}

function applyAlignRange(editor, dir, from, to) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = bulkSetTextAlignRange(state, view.dispatch, from, to, dir);
  if (done) view.focus();
  return done;
}

// VO across the snapshot range — every convertible block the CLICKED LANE touched, one transaction.
function applyVoRange(editor, from, to, clickedRole) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  return bulkRetypeToVo(state, view.dispatch, from, to, clickedRole);
}

// TIMECODE TAG — the DETERMINISTIC bake (Johnny 2026-07-22: "highlight, right-click, TIMECODE TAG,
// and it bakes into that formatting with the click-to-copy feature"). Runs the SAME machinery the
// right-click retro-convert on plain text uses — marks.js convertTimecodesInRange over the SELECTION:
// it wraps every bare broadcast code in the real timecode chip, captures a "DAY N" prefix when the
// selection holds one (else leaves day=null → the DAY ? state), pairs day-less existing chips, and
// strips folded DAY literals — all in ONE transaction (one undo). Deliberately LANE-AGNOSTIC: a hand
// selection is explicit intent, so we convert every code inside it (no said/shown scoping like the role
// tags). The chip's click-to-copy + right-click DAY/sequence menu come free (it's the real mark). Works
// in EVERY context — bullets, broll/oncam runs, nested rows — because convertTimecodesInRange flattens
// the range's inline text (inlineTextMap) rather than pattern-matching a lane. Returns true when it
// baked at least one code; false (no dispatch, no transaction) when the selection holds no parseable
// code — the caller then shakes the button instead of silently closing.
function applyTimecodeTagRange(editor, from, to) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const done = convertTimecodesInRange(state, from, to, (tr) => view.dispatch(tr));
  if (done) view.focus();
  return done;
}

// Subtle no-op feedback: a short shake + opacity flash on the button when a TIMECODE TAG click found
// no code to bake. Uses the Web Animations API (element.animate) so it needs NO stylesheet rule —
// styles.css is owned by a sibling change this pass, and a JS-driven animation keeps this file
// self-contained. Guarded for headless/older engines where .animate is absent.
function shakeNoOp(btn) {
  if (!btn || typeof btn.animate !== 'function') return;
  try {
    btn.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' },
       { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
      { duration: 220, easing: 'ease-in-out' },
    );
    btn.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 220 });
  } catch {}
}

// Delete the outermost rows captured when the menu opened. Rows are re-resolved by IDENTITY (node
// ref → first-block id → pairId) against the CURRENT doc, so a remote collab edit that shifted
// positions while the menu was open still deletes the right band (mirrors table.js's row-drag
// re-resolution). Survivors are deleted even if a captured row already vanished remotely.
function deleteRows(editor, rowRefs) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  const positions = rowRefs
    .map((ref) => findRowByIdentity(state.doc, ref))
    .filter((p) => p != null);
  if (!positions.length) return false;
  return doDeleteRows(state, view.dispatch, positions);
}

// Render a real chip preview for a tag. A directionMark kind reuses the doc's own .wp-dhl[data-kind]
// styling, so the menu previews EXACTLY what the tag will look like once applied. VO isn't a mark
// (no .wp-dhl kind), so it gets its own small dark cap chip that reads like the block's VO corner tag.
function chipFor(item) {
  if (item.kind === '__vo') {
    const chip = el('span', 'wp-bulk-chip wp-bulk-chip-vo');
    chip.textContent = item.label;
    return chip;
  }
  const chip = el('span', 'wp-bulk-chip wp-dhl', {
    'data-kind': item.kind,
    'data-status': defaultDirectionMarkAttrs(item.kind).status,
  });
  chip.textContent = item.label;
  return chip;
}

function pluralRows(n) {
  return `DELETE ${n} ROW${n === 1 ? '' : 'S'}`;
}

// A single live menu instance. Rendered into <body>, positioned near the pointer, closed on Escape,
// pick, or any click/scroll/resize away from it. Fully keyboard-driven (Up/Down/Home/End/Enter/Esc).
function createConvertMenu(editor, x, y, clickedRole) {
  // Snapshot the selection + the rows it touches AT OPEN. Every action below uses this snapshot so
  // the tag preview, the delete count, and the actual writes can never disagree with each other.
  const { from, to } = editor.state.selection;
  const snapRows = collectIntersectingRows(editor.state.doc, from, to);
  const rowRefs = snapRows.map(({ node }) => ({
    node,
    blockId: rowFirstBlockId(node),
    pairId: node.attrs?.pairId || null,
  }));
  const rowCount = snapRows.length;

  // The pickable entries, in Johnny's reading order: role chips first (unchanged), a hairline,
  // ONE compact utility row (TK · FC · the three alignment squares — the bubble's survivors),
  // a hairline, DELETE N ROWS last (unchanged). All entries stay in one flat keyboard ring.
  const entries = VIZ_KINDS.map((item) => ({ type: 'tag', item }));
  UTILITY_SPANS.forEach((item) => entries.push({ type: 'span', item }));
  ALIGNMENTS.forEach((item) => entries.push({ type: 'align', item }));
  // TIMECODE TAG — the deterministic bake, last in the utility row. Always offered on a non-empty
  // selection (the menu only opens on one); it no-ops with a shake when the selection holds no code.
  entries.push({ type: 'timecode' });
  if (rowCount > 0) entries.push({ type: 'delete' });

  // Pressed-state paint at open (the bubble's `.active` equivalent), computed against the SAME
  // snapshot + lane scoping the writes will use, so the paint can never promise the wrong toggle.
  const snapLaneRanges = laneCellRanges(editor.state.doc, Math.min(from, to), Math.max(from, to), clickedRole);
  const spanActive = (markName) => {
    const markType = editor.state.schema.marks[markName];
    return !!markType && rangesFullyMarked(editor.state.doc, snapLaneRanges, markType);
  };

  let activeIndex = 0;
  const menu = el('div', 'wp-bulk-menu wp-convert-menu wp-slash-menu', { contenteditable: 'false', role: 'menu' });

  const buttons = [];

  let onDocDown = null;
  let onKey = null;
  let onScroll = null;
  const returnFocus = (typeof document !== 'undefined') ? document.activeElement : null;

  const close = () => {
    if (!menu.parentNode) return;
    if (onDocDown) document.removeEventListener('mousedown', onDocDown, true);
    if (onKey) document.removeEventListener('keydown', onKey, true);
    if (onScroll) {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    }
    menu.remove();
  };

  const paintActive = () => {
    buttons.forEach((b, i) => b.classList.toggle('is-active', i === activeIndex));
  };

  const pick = (index) => {
    const entry = entries[index];
    if (!entry) return;
    // TIMECODE TAG bakes IN PLACE: probe-and-apply BEFORE closing so a codeless selection can shake
    // the button (clear "nothing matched" feedback) instead of the menu vanishing on a silent no-op.
    if (entry.type === 'timecode') {
      const baked = applyTimecodeTagRange(editor, from, to);
      if (baked) { close(); editor.view.focus(); }
      else { shakeNoOp(buttons[index]); }
      return;
    }
    close();
    if (entry.type === 'delete') {
      deleteRows(editor, rowRefs);
    } else if (entry.type === 'span') {
      applySpanRange(editor, entry.item.mark, from, to, clickedRole);
    } else if (entry.type === 'align') {
      applyAlignRange(editor, entry.item.dir, from, to);
    } else if (entry.item.kind === '__vo') {
      applyVoRange(editor, from, to, clickedRole);
    } else {
      applyMarkRange(editor, entry.item.kind, from, to, clickedRole);
    }
    editor.view.focus();
  };

  // The compact utility row (TK · FC · align squares) — created lazily when its first entry
  // renders, hairline-separated from the role chips above and the delete below.
  let utilRow = null;
  const ensureUtilRow = () => {
    if (utilRow) return utilRow;
    menu.appendChild(el('div', 'wp-slash-sep'));
    utilRow = el('div', 'wp-bulk-utils', { role: 'none' });
    menu.appendChild(utilRow);
    return utilRow;
  };

  entries.forEach((entry, index) => {
    if (entry.type === 'span') {
      // TK / FC — the mark's REAL chip look (wp-tk yellow / wp-fc red wash), same preview-is-
      // truth law as the role chips above.
      const button = el('button', 'wp-convert-item wp-bulk-util wp-bulk-util-span', {
        type: 'button', role: 'menuitem', 'data-span': entry.item.mark, title: entry.item.title,
        'aria-label': entry.item.title,
      });
      const chip = el('span', 'wp-bulk-chip ' + entry.item.chipClass);
      chip.textContent = entry.item.label;
      button.appendChild(chip);
      if (spanActive(entry.item.mark)) button.classList.add('is-on');
      button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
      button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
      buttons.push(button);
      ensureUtilRow().appendChild(button);
      return;
    }
    if (entry.type === 'align') {
      // The three alignment tools — small flat squares, the bubble's exact glyphs.
      const button = el('button', 'wp-convert-item wp-bulk-util wp-bulk-util-align', {
        type: 'button', role: 'menuitem', 'data-align': entry.item.dir, title: entry.item.title,
        'aria-label': entry.item.title,
      });
      button.textContent = entry.item.glyph;
      if (rangeAlignActive(editor.state.doc, from, to, entry.item.dir)) button.classList.add('is-on');
      button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
      button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
      buttons.push(button);
      ensureUtilRow().appendChild(button);
      return;
    }
    if (entry.type === 'timecode') {
      // TIMECODE TAG — a labeled utility button that bakes the selection's broadcast codes into real
      // timecode chips (deterministic, one undo). Shows a tiny chip preview so it reads as "make this
      // a chip", then the label. Same flat util-button chrome as TK/FC.
      const button = el('button', 'wp-convert-item wp-bulk-util wp-bulk-util-tc', {
        type: 'button', role: 'menuitem', 'data-action': 'timecode-tag',
        title: 'Bake the selected timecode(s) into click-to-copy chips',
        'aria-label': 'Bake selected timecodes into chips',
      });
      const chip = el('span', 'wp-bulk-chip wp-tc-tag');
      chip.textContent = '00:00:00:00';
      const label = el('span', 'wp-convert-label');
      label.textContent = 'TIMECODE TAG';
      button.appendChild(chip);
      button.appendChild(label);
      button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
      button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
      buttons.push(button);
      ensureUtilRow().appendChild(button);
      return;
    }
    if (entry.type === 'delete') {
      // Hairline before the destructive entry, then the delete row itself (red, mono count).
      menu.appendChild(el('div', 'wp-slash-sep'));
      const button = el('button', 'wp-convert-item wp-slash-item wp-bulk-delete is-danger', {
        type: 'button',
        role: 'menuitem',
        'data-action': 'delete-rows',
      });
      const label = el('span', 'wp-convert-label');
      label.textContent = pluralRows(rowCount);
      button.appendChild(label);
      button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
      button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
      buttons.push(button);
      menu.appendChild(button);
      return;
    }
    const item = entry.item;
    const button = el('button', 'wp-convert-item wp-slash-item wp-bulk-item', {
      type: 'button',
      role: 'menuitem',
      'data-kind': item.kind,
    });
    button.appendChild(chipFor(item));
    button.addEventListener('mouseenter', () => { activeIndex = index; paintActive(); });
    button.addEventListener('mousedown', (e) => { e.preventDefault(); pick(index); });
    buttons.push(button);
    menu.appendChild(button);
  });

  paintActive();
  document.body.appendChild(menu);

  // Position near the pointer, clamped to the viewport (same fixed-position discipline as the
  // slash / timecode menus).
  menu.style.position = 'fixed';
  menu.style.top = `${y}px`;
  menu.style.left = `${x}px`;
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
  if (box.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;

  onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); if (returnFocus && returnFocus.focus) returnFocus.focus(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % entries.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + entries.length) % entries.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); activeIndex = 0; paintActive(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); activeIndex = entries.length - 1; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); pick(activeIndex); }
  };
  onDocDown = (e) => { if (!menu.contains(e.target)) close(); };
  onScroll = () => close();

  document.addEventListener('keydown', onKey, true);
  // Defer the click-away listener a tick so the opening right-click's own mouseup/down doesn't
  // instantly close it.
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);

  // Focus the first item a frame later (so the contextmenu event settles first) for keyboard nav.
  requestAnimationFrame(() => { if (buttons[0]) buttons[0].focus(); });

  return { menu, close };
}

let openConvertMenu = null;

function closeOpenConvertMenu() {
  if (openConvertMenu) { openConvertMenu.close(); openConvertMenu = null; }
}

export const ConvertMenu = Extension.create({
  name: 'convertMenu',
  addProseMirrorPlugins() {
    if (isReadOnly()) return [];
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              // Gated on the `convertMenu` feature flag (Palau + Burma opt in): an episode that
              // hasn't opted in keeps its native right-click untouched.
              if (!episodeFlag('convertMenu')) return false;
              if (isReadOnly()) return false;
              // Only open on a real, non-empty text selection. Empty selection → let the timecode
              // chip's sequence menu and the browser's native menu run as before.
              const { from, to } = view.state.selection;
              if (from === to) return false;
              // Never steal a right-click that landed on an existing chip (timecode / legacy dchip);
              // that chip owns its own context menu. Order-independent safety net.
              const onChip = event.target && event.target.closest
                ? event.target.closest('span.wp-tc-tag, span[data-tc], span[data-dchip]')
                : null;
              if (onChip) return false;

              // Capture WHICH LANE the pointer is over, at click time, so every bulk tag scopes to
              // that column (said vs shown) — the fix for "lay VO tags into the left column not both".
              const clickedRole = clickedCellRole(view, event.clientX, event.clientY);

              event.preventDefault();
              closeOpenConvertMenu();
              openConvertMenu = createConvertMenu(this.editor, event.clientX, event.clientY, clickedRole);
              return true;
            },
          },
        },
      }),
    ];
  },
});
