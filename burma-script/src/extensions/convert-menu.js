import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { episodeFlag } from '../episode-config.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';
import { retypeHostToVo, bulkRetypeToVo, laneMatches } from './slash-menu.js';
import { collectIntersectingRows, doDeleteRows, rowFirstBlockId } from './table.js';
import { findRowByIdentity } from './table.js';

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
//   2. DELETE. A destructive entry at the very bottom, hairline-separated, carrying a LIVE count of
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
  for (const [f, t] of ranges) tr.addMark(f, t, mark);
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

// VO across the snapshot range — every convertible block the CLICKED LANE touched, one transaction.
function applyVoRange(editor, from, to, clickedRole) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  return bulkRetypeToVo(state, view.dispatch, from, to, clickedRole);
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

  // The pickable entries: the tags, then (when the selection touches at least one row) the delete.
  const entries = VIZ_KINDS.map((item) => ({ type: 'tag', item }));
  if (rowCount > 0) entries.push({ type: 'delete' });

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
    close();
    if (entry.type === 'delete') {
      deleteRows(editor, rowRefs);
    } else if (entry.item.kind === '__vo') {
      applyVoRange(editor, from, to, clickedRole);
    } else {
      applyMarkRange(editor, entry.item.kind, from, to, clickedRole);
    }
    editor.view.focus();
  };

  entries.forEach((entry, index) => {
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
