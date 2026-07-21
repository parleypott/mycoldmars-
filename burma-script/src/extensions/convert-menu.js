import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { episodeFlag } from '../episode-config.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';
import { retypeHostToVo, bulkRetypeToVo } from './slash-menu.js';
import { collectIntersectingRows, doDeleteRows, rowFirstBlockId } from './table.js';
import { findRowByIdentity } from './table.js';

// ── SELECT → RIGHT-CLICK → BULK ROW MENU ─────────────────────────────────────────────────────────
// Highlight a run of text — anywhere from a few words to a span crossing many rows — right-click,
// and get one premium floating menu that does two jobs at once:
//
//   1. TAGS. Every role tag Johnny uses, each shown as its REAL chip (same colours the doc renders:
//      3d = purple + yellow, sot = red-purple italic, oncam = warm italic ink, …). Clicking a tag
//      bulk-applies it across the WHOLE selection in one transaction — "load all of these rows up
//      with 3D ANIMATION". VO is the one BLOCK action: it retypes every convertible block the
//      selection touches into a voBlock (shared bulkRetypeToVo), the same conversion /vo runs.
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

// Apply the chosen viz kind across a specific [from,to] range. Uses the shared default-attrs helper
// so a bulk-applied run is byte-identical to one the slash menu would produce for that kind. Passed
// the SNAPSHOT range captured when the menu opened (not the live selection) so what the chip preview
// promised is exactly what lands — a remote collab edit mid-menu can't retarget the apply.
function applyMarkRange(editor, kind, from, to) {
  if (isReadOnly()) return false;
  if (from === to) return false; // never mark an empty selection
  return editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setMark('directionMark', defaultDirectionMarkAttrs(kind))
    .run();
}

// VO across the snapshot range — every convertible block the selection touched, one transaction.
function applyVoRange(editor, from, to) {
  if (isReadOnly()) return false;
  const { state, view } = editor;
  return bulkRetypeToVo(state, view.dispatch, from, to);
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
function createConvertMenu(editor, x, y) {
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
      applyVoRange(editor, from, to);
    } else {
      applyMarkRange(editor, entry.item.kind, from, to);
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

              event.preventDefault();
              closeOpenConvertMenu();
              openConvertMenu = createConvertMenu(this.editor, event.clientX, event.clientY);
              return true;
            },
          },
        },
      }),
    ];
  },
});
