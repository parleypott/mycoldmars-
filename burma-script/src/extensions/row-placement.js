// Burma Script Tool — TRANSFER / COPY SECTION: PLACEMENT MODE (decoration-only interaction state).
//
// The right-click menu (convert-menu.js) offers "transfer this section" / "copy this section" on a
// multi-row selection. Choosing either fires a `wp-row-placement` window event carrying the rowRefs
// snapshot + a mode flag, and this plugin flips into PLACEMENT MODE:
//   • the selected rows LIFT (a display-tweak node decoration — never display:none, they stay
//     measurable and in view);
//   • every GAP between two top-level rows (and top/bottom of the doc) becomes a glowing clickable
//     insert target — a widget decoration carrying its own data-gap-index;
//   • clicking a gap COMMITS: ONE user-initiated transaction (moveRowRange for transfer,
//     copyRowRange for copy) that ALSO clears the placement meta in the same dispatch;
//   • Esc, a click on the backdrop, or a click anywhere in the editor that ISN'T a gap CANCELS with
//     zero doc change.
//
// ── COLLAB LOOP LAW (repo CLAUDE.md) ─────────────────────────────────────────────────────────────
// chapter-focus.js / row-numbers.js are the exact template: a Plugin whose state holds a UI-mode
// payload set via tr.setMeta, rebuilding a DecorationSet from it. Entering / hovering / cancelling
// dispatch NOTHING to the doc — they only recompute decorations (pure). The ONLY doc mutation is the
// single commit transaction on the user's gap-click. Nothing auto-fires, so a remote y-sync echo can
// never re-trigger a move or lock the tab. Rows are captured by IDENTITY (rowRefs) and re-resolved
// at commit (findRowByIdentity inside resolveRowRange), so a remote edit mid-placement still lands
// the right band at the right gap.
//
// ── READ-ONLY ────────────────────────────────────────────────────────────────────────────────────
// Mounts nothing when isReadOnly() (a ?read reader never restructures the author's script), exactly
// like ConvertMenu returning []. Entering also arms EDIT mode from sticky-READ (the same auto-arm
// the row grip and the right-click menu use), because committing a placement is reaching for the pen.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isReadOnly } from '../read-mode.js';
import { setEditMode } from '../edit-mode.js';
import { episodeFlag } from '../episode-config.js';
import { resolveRowRange, posOfChildIndex, moveRowRange, copyRowRange } from './row-transfer.js';

export const rowPlacementKey = new PluginKey('wpRowPlacement');

const EMPTY = { session: null, decorations: DecorationSet.empty };

// The glowing gap affordance — a flat orange insert line + a small mono label. On-doctrine: FLAT,
// no shadows, hairline accent (the row-drag drop indicator's family). contenteditable=false so it
// never becomes a caret target; it owns its own clicks (the pointer-events trap doctrine — a real
// element that receives the mousedown, never a pointer-events:none paint).
function buildGapDOM(gapIndex, mode) {
  const wrap = document.createElement('div');
  wrap.className = 'wp-placement-gap' + (mode === 'copy' ? ' is-copy' : '');
  wrap.setAttribute('contenteditable', 'false');
  wrap.setAttribute('data-gap-index', String(gapIndex));
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('aria-label', (mode === 'copy' ? 'Copy' : 'Move') + ' section here');
  const line = document.createElement('div');
  line.className = 'wp-placement-gap-line';
  const label = document.createElement('span');
  label.className = 'wp-placement-gap-label';
  label.textContent = mode === 'copy' ? 'copy here' : 'move here';
  wrap.appendChild(line);
  wrap.appendChild(label);
  return wrap;
}

// The decoration set for a live placement session: LIFT the selected rows + a GAP widget at every
// legal top-level boundary. Exported for the headless suite. A section that no longer resolves
// (deleted remotely mid-placement) degrades to an EMPTY set rather than a stuck overlay.
export function buildPlacementDecorations(doc, session) {
  if (!session || !session.rowRefs) return DecorationSet.empty;
  const range = resolveRowRange(doc, session.rowRefs);
  if (!range) return DecorationSet.empty;
  const { startIndex, endIndex } = range;
  const decos = [];
  // LIFT — node decoration on each row of the section (CSS gives it opacity/translate; measurable).
  for (let i = startIndex; i < endIndex; i++) {
    const from = posOfChildIndex(doc, i);
    const node = doc.child(i);
    decos.push(Decoration.node(from, from + node.nodeSize, { class: 'wp-placement-lift' }));
  }
  // GAP targets — every top-level boundary in [0, childCount], with mode-specific suppression:
  //   • TRANSFER suppresses the whole CLOSED range [startIndex, endIndex]: the two edges are no-ops
  //     (moving the section flush against itself) and the interior is a self-nest — none are real
  //     transfer targets.
  //   • COPY suppresses ONLY the strict INTERIOR (startIndex < g < endIndex): a duplicate dropped
  //     between two origin rows would interleave into the source. But the two EDGE gaps g=startIndex
  //     (flush ABOVE the origin) and g=endIndex (flush BELOW the origin) are the two most natural
  //     copy targets — "duplicate this right next to the original so I can tweak it" — so copy keeps
  //     them. copyRowRange already accepts them (it never no-ops); withholding them was purely a
  //     cosmetic "read identically in both modes" and it hid the most-wanted targets.
  const isCopy = session.mode === 'copy';
  for (let g = 0; g <= doc.childCount; g++) {
    if (isCopy) { if (g > startIndex && g < endIndex) continue; }
    else if (g >= startIndex && g <= endIndex) continue;
    const pos = posOfChildIndex(doc, g);
    decos.push(Decoration.widget(pos, () => buildGapDOM(g, session.mode), {
      key: 'wp-gap-' + g, side: -1, ignoreSelection: true,
    }));
  }
  return DecorationSet.create(doc, decos);
}

function getPlacementState(state) {
  return rowPlacementKey.getState(state) || EMPTY;
}

// Exported for the headless suite — the current session (or null).
export function placementSession(state) {
  return getPlacementState(state).session;
}

export const RowPlacement = Extension.create({
  name: 'rowPlacement',
  addProseMirrorPlugins() {
    if (isReadOnly()) return [];   // a ?read reader never restructures the script

    const enter = (view, mode, rowRefs) => {
      if (!episodeFlag('convertMenu')) return;              // same gate as the menu that fires it
      if (isReadOnly()) return;
      if (!Array.isArray(rowRefs) || !rowRefs.length) return;
      if (!view.editable) { try { setEditMode(true); } catch {} } // READ→EDIT auto-arm (never ?read)
      view.dispatch(view.state.tr.setMeta(rowPlacementKey, {
        session: { mode: mode === 'copy' ? 'copy' : 'transfer', rowRefs },
      }));
    };

    // Clear placement with NO doc change (cancel path).
    const cancel = (view) => {
      if (!getPlacementState(view.state).session) return;
      view.dispatch(view.state.tr.setMeta(rowPlacementKey, null));
    };

    // Commit at a chosen gap: the engine dispatches ONE transaction that also clears the placement
    // meta (folded into the same tr → one undo restores the pre-move doc AND exits placement mode).
    const commit = (view, session, gapIndex) => {
      if (!Number.isInteger(gapIndex)) { cancel(view); return; }
      const dispatchClearing = (tr) => view.dispatch(tr.setMeta(rowPlacementKey, null));
      const fn = session.mode === 'copy' ? copyRowRange : moveRowRange;
      const ok = fn(view.state, dispatchClearing, session.rowRefs, gapIndex);
      if (!ok) cancel(view);   // illegal / no-op target → exit cleanly rather than trap the user
      try { view.focus(); } catch {}
    };

    return [new Plugin({
      key: rowPlacementKey,
      state: {
        init: () => EMPTY,
        apply(tr, prev) {
          const meta = tr.getMeta(rowPlacementKey);
          if (meta !== undefined) {
            const session = meta && meta.session ? meta.session : null;
            if (!session) return prev === EMPTY ? prev : EMPTY;
            return { session, decorations: buildPlacementDecorations(tr.doc, session) };
          }
          if (!prev.session) return prev;                    // idle — nothing to do
          if (tr.docChanged) {                               // rows can shift under collab — rebuild
            return { session: prev.session, decorations: buildPlacementDecorations(tr.doc, prev.session) };
          }
          const mapped = prev.decorations.map(tr.mapping, tr.doc);
          return mapped === prev.decorations ? prev : { session: prev.session, decorations: mapped };
        },
      },
      props: {
        decorations(state) {
          return getPlacementState(state).decorations;
        },
        // The ONLY commit/cancel surface. A gap mousedown commits; any other mousedown inside the
        // editor cancels (structurally scoped: only gap widgets carry .wp-placement-gap, so cell
        // interiors are never commit targets — no row-body hit-testing needed).
        handleDOMEvents: {
          mousedown(view, event) {
            const session = getPlacementState(view.state).session;
            if (!session) return false;
            const gapEl = event.target && event.target.closest
              ? event.target.closest('.wp-placement-gap') : null;
            event.preventDefault();
            if (gapEl) {
              const gapIndex = parseInt(gapEl.getAttribute('data-gap-index'), 10);
              commit(view, session, gapIndex);
            } else {
              cancel(view);
            }
            return true;
          },
        },
      },
      view(editorView) {
        // Full-page backdrop: captures click-outside-the-editor as a cancel and lightly dims the
        // page so placement mode reads as a distinct state. The editor is raised above it (CSS
        // .wp-placement-active) so the in-doc gap widgets stay clickable.
        const backdrop = document.createElement('div');
        backdrop.className = 'wp-placement-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.style.display = 'none';
        backdrop.addEventListener('mousedown', (e) => {
          e.preventDefault();
          cancel(editorView);
        });
        document.body.appendChild(backdrop);

        const onEnter = (e) => {
          const d = e.detail || {};
          enter(editorView, d.mode, d.rowRefs);
        };
        // Esc cancels (capture phase, so it wins before other Esc handlers — the OutlinePanel /
        // menu precedent). No-op when not in placement mode, so it never swallows a stray Esc.
        const onKey = (e) => {
          if (e.key !== 'Escape') return;
          if (!getPlacementState(editorView.state).session) return;
          e.preventDefault();
          e.stopPropagation();
          cancel(editorView);
        };
        window.addEventListener('wp-row-placement', onEnter);
        document.addEventListener('keydown', onKey, true);

        const sync = () => {
          const active = !!getPlacementState(editorView.state).session;
          backdrop.style.display = active ? 'block' : 'none';
          try { document.documentElement.classList.toggle('wp-placement-active', active); } catch {}
        };
        sync();

        return {
          update: sync,
          destroy() {
            window.removeEventListener('wp-row-placement', onEnter);
            document.removeEventListener('keydown', onKey, true);
            try { backdrop.remove(); } catch {}
            try { document.documentElement.classList.remove('wp-placement-active'); } catch {}
          },
        };
      },
    })];
  },
});
