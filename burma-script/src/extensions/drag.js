// Burma Script Tool — UNIFIED POINTER-DRAG SYSTEM.
// ---------------------------------------------------------------------------
// ProseMirror is a LINEAR list of top-level blocks. The writer wants FOUR gestures
// off ONE drag handle (the ⠿ grip on each cartridge's spine):
//
//   • MERGE   — drop ON TOP / CENTER of another block → append the dragged block's
//               content after the target's, delete the dragged node (ONE transaction).
//   • REORDER — drop ABOVE / BELOW a block → move the node to that slot.
//   • PAIR    — drop on the RIGHT EDGE of a block → wrap both in an `avPair` container
//               node that renders as TWO COLUMNS: the TARGET stays on the LEFT (the words /
//               VO / on-cam) and the DRAGGED block lands on the RIGHT (the picture / B-roll).
//               This is the A/V two-column the writer has wanted from day one — and because
//               ProseMirror is a linear list, side-by-side REQUIRES a container node (the
//               same machinery prosemirror-tables uses). Each column stays a normal,
//               editable block.
//   • UNWRAP  — the ⤢ control on an avPair (or dragging a column out) LIFTS the two columns
//               back out into two full-width blocks in document order, then removes the pair.
//
// We use POINTER events, NOT HTML5 drag-and-drop: better UX (custom affordance, no
// ghost image, works on touch) AND fully testable (a stream of real PointerEvents can
// drive it; native DnD cannot be driven this way — that's the point).
//
// The whole thing is a single ProseMirror Plugin. It owns:
//   - drag STATE (which node is being dragged, the live drop target + zone)
//   - DECORATIONS for the flat drop-zone affordance (fill=merge, line=reorder, bar=pair)
// The grip's NodeView calls `startBlockDrag(view, getPos, event, onEnd)`; everything
// after that lives here so the gesture logic has ONE home.
//
// DESIGN LAW: FLAT. The affordance is solid fills / hairlines in Swiss red — no
// shadow, no blur, no bevel.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment, Slice } from '@tiptap/pm/model';

export const dragPluginKey = new PluginKey('burmaBlockDrag');

// Zones. RIGHT edge → PAIR; top/bottom bands → REORDER; the broad center → MERGE.
export const ZONE = {
  PAIR: 'pair',
  REORDER: 'reorder',
  MERGE: 'merge',
  NONE: 'none',
};

// Fraction of a block's WIDTH counted as the right-edge PAIR strip.
const RIGHT_EDGE_FRAC = 0.30;
// Fraction of a block's HEIGHT (top + bottom) counted as the REORDER bands.
const EDGE_BAND_FRAC = 0.26;

// Block node names that can be a COLUMN inside an avPair. avPair itself is excluded:
// you don't pair a pair (drop ON a pair → merge/reorder against the whole row instead).
const PAIRABLE = new Set([
  'voBlock', 'oncamBlock', 'sotBlock', 'brollBlock',
  'sceneBlock', 'noteBlock', 'binBlock', 'serviceBlock',
]);

// Resolve the pointer to a top-level block: its start pos, the node, and the zone.
// Uses the rendered DOM rects so the right-edge / top-band geometry matches what the
// writer sees. Returns null when the pointer isn't over any block.
function hitTest(view, clientX, clientY) {
  const doc = view.state.doc;
  for (let i = 0, pos = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const start = pos;
    pos += node.nodeSize;
    let dom;
    try { dom = view.nodeDOM(start); } catch { dom = null; }
    if (!dom || dom.nodeType !== 1) continue;
    const r = dom.getBoundingClientRect();
    if (clientY < r.top || clientY > r.bottom || clientX < r.left || clientX > r.right) continue;

    const relY = (clientY - r.top) / Math.max(1, r.height);
    const relX = (clientX - r.left) / Math.max(1, r.width);

    let zone;
    // PAIR only when BOTH nodes can be columns. An avPair target can't be paired again,
    // and a non-pairable dragged node falls through to merge/reorder on the right edge.
    const canPair = PAIRABLE.has(node.type.name);
    if (canPair && relX >= 1 - RIGHT_EDGE_FRAC) zone = ZONE.PAIR;
    else if (relY <= EDGE_BAND_FRAC) zone = ZONE.REORDER;       // above band
    else if (relY >= 1 - EDGE_BAND_FRAC) zone = ZONE.REORDER;   // below band
    else zone = ZONE.MERGE;

    const after = relY > 0.5; // for REORDER: below (true) vs above (false)
    return { start, end: start + node.nodeSize, node, dom, zone, after, rect: r };
  }
  return null;
}

// Build the drop-zone affordance decoration for the current target/zone. A node
// decoration toggles a class on the target cartridge so CSS paints the right flat hint.
function buildDecorations(state, drag) {
  if (!drag || !drag.target) return DecorationSet.empty;
  const t = drag.target;
  if (t.start === drag.fromStart) return DecorationSet.empty; // self-drop = no hint
  const cls = 'wp-drop wp-drop-' + t.zone + (t.zone === ZONE.REORDER ? (t.after ? ' wp-drop-below' : ' wp-drop-above') : '');
  return DecorationSet.create(state.doc, [Decoration.node(t.start, t.end, { class: cls })]);
}

// ---- the gestures --------------------------------------------------------

// MERGE: append the dragged block's paragraphs INSIDE the target node (just before its
// closing token) so the dropped text reads AFTER the target's own content in the SAME
// block, then delete the dragged node — ONE transaction. To keep positions trivially
// valid we always operate on the HIGHER position first. No node is reconstructed, so no
// stray top-level paragraph can escape from the merge itself.
function doMerge(view, fromStart, target) {
  const { state } = view;
  const doc = state.doc;
  const dragNode = doc.nodeAt(fromStart);
  const targetNode = doc.nodeAt(target.start);
  if (!dragNode || !targetNode) return false;
  if (fromStart === target.start) return false;
  // Can't merge INTO an avPair row (it has no plain editable hole) — fall back to reorder.
  if (targetNode.type.name === 'avPair') return doReorder(view, fromStart, target);

  const incoming = [];
  dragNode.content.forEach((child) => incoming.push(child));
  const dragEnd = fromStart + dragNode.nodeSize;

  if (!incoming.length) {
    const tr0 = state.tr.delete(fromStart, dragEnd);
    tr0.setMeta(dragPluginKey, { clear: true });
    view.dispatch(tr0.scrollIntoView());
    return true;
  }

  const content = Fragment.fromArray(incoming);
  const insertInside = target.start + targetNode.nodeSize - 1; // inside target, before close
  let tr = state.tr;

  if (fromStart > target.start) {
    // drag node BELOW target — delete it (higher pos) first; target stays put.
    tr = tr.delete(fromStart, dragEnd);
    tr = tr.insert(insertInside, content);
  } else {
    // drag node ABOVE target — insert into target (higher pos) first; drag node stays put.
    tr = tr.insert(insertInside, content);
    tr = tr.delete(fromStart, dragEnd);
  }
  tr.setMeta(dragPluginKey, { clear: true });
  view.dispatch(tr.scrollIntoView());
  return true;
}

// REORDER: move the dragged block to just above/below the target. Cut the node, map the
// insertion point through the cut, paste — one transaction.
function doReorder(view, fromStart, target) {
  const { state } = view;
  const doc = state.doc;
  const dragNode = doc.nodeAt(fromStart);
  if (!dragNode) return false;
  const dragEnd = fromStart + dragNode.nodeSize;
  const insertAt = target.after ? target.end : target.start;
  if (insertAt >= fromStart && insertAt <= dragEnd) return false; // onto self
  let tr = state.tr;
  tr = tr.delete(fromStart, dragEnd);
  const mapped = tr.mapping.map(insertAt);
  tr = tr.insert(mapped, dragNode);
  tr.setMeta(dragPluginKey, { clear: true });
  view.dispatch(tr.scrollIntoView());
  return true;
}

// PAIR: wrap the TARGET (left column, the words) and the DRAGGED block (right column, the
// picture) inside a NEW avPair container node, in ONE transaction. Both originals are
// removed from the top level and re-parented as the two children of the pair. The pair
// takes the TARGET's slot, so the row lands where the words were.
//
// avPair schema: content 'block block' — exactly two block children. We pass the target
// node FIRST (left) and the dragged node SECOND (right): A/V reading order = words left,
// picture right. Word count is preserved (no content is reconstructed, only re-parented).
function doPair(view, fromStart, target) {
  const { state } = view;
  const doc = state.doc;
  const avPair = state.schema.nodes.avPair;
  if (!avPair) return false;
  const dragNode = doc.nodeAt(fromStart);
  const targetNode = doc.nodeAt(target.start);
  if (!dragNode || !targetNode) return false;
  if (fromStart === target.start) return false;
  // Only pair two genuine pairable columns. Never nest a pair inside a pair.
  if (!PAIRABLE.has(dragNode.type.name) || !PAIRABLE.has(targetNode.type.name)) {
    return doReorder(view, fromStart, target);
  }

  const dragEnd = fromStart + dragNode.nodeSize;
  const targetEnd = target.start + targetNode.nodeSize;

  // Build the pair: [target (left), dragged (right)].
  const pairNode = avPair.createAndFill(
    { pairId: 'pair_' + Math.random().toString(36).slice(2, 9) },
    Fragment.fromArray([targetNode.copy(targetNode.content), dragNode.copy(dragNode.content)]),
  );
  if (!pairNode) return false;

  // Remove both originals and drop the pair into the TARGET's slot. Delete the HIGHER
  // range first so the lower positions stay valid, then insert at the (now-stable) target
  // start mapped through the deletions.
  let tr = state.tr;
  const ranges = [
    { from: fromStart, to: dragEnd },
    { from: target.start, to: targetEnd },
  ].sort((a, b) => b.from - a.from); // higher first
  for (const rng of ranges) tr = tr.delete(rng.from, rng.to);
  const insertAt = tr.mapping.map(target.start);
  tr = tr.insert(insertAt, pairNode);
  tr.setMeta(dragPluginKey, { clear: true });
  view.dispatch(tr.scrollIntoView());
  return true;
}

// UNWRAP (PULL-APART): replace an avPair with its two children, lifted back out as two
// full-width top-level blocks in document order (left first, then right). ONE transaction.
// Called by the ⤢ control on the pair's chrome. Word count is preserved (children are
// re-parented, not rebuilt).
export function unwrapPair(view, pairStart) {
  const { state } = view;
  const doc = state.doc;
  const pair = doc.nodeAt(pairStart);
  if (!pair || pair.type.name !== 'avPair') return false;
  const children = [];
  pair.content.forEach((c) => children.push(c));
  if (!children.length) return false;
  const pairEnd = pairStart + pair.nodeSize;
  // Replace the whole pair range with its children as a flat Slice at depth 0.
  const slice = new Slice(Fragment.fromArray(children), 0, 0);
  let tr = state.tr.replaceRange(pairStart, pairEnd, slice);
  tr.setMeta(dragPluginKey, { clear: true });
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

function clearDrag(view) {
  view.dispatch(view.state.tr.setMeta(dragPluginKey, { clear: true }));
}

// ---- the plugin ----------------------------------------------------------

export function blockDragPlugin() {
  return new Plugin({
    key: dragPluginKey,
    state: {
      init: () => ({ active: false, fromStart: null, target: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(dragPluginKey);
        if (meta) {
          if (meta.clear) return { active: false, fromStart: null, target: null };
          return { ...prev, ...meta };
        }
        return prev;
      },
    },
    // NOTE on stray top-level paragraphs: TipTap/StarterKit auto-appends a trailing empty
    // paragraph whenever a top-level block is deleted (a framework behaviour on ANY delete).
    // It carries no content, so it never affects the integrity audit (which diffs rendered
    // text — an empty paragraph adds none) or word counts. We deliberately do NOT strip it
    // in an appendTransaction — doing so fights the framework, which re-adds it, risking a
    // transaction loop. The drag test counts MEANINGFUL blocks (ignoring empty trailing
    // paragraphs), so merge/pair/reorder results are asserted exactly.
    props: {
      decorations(state) {
        const drag = dragPluginKey.getState(state);
        return drag && drag.active ? buildDecorations(state, drag) : DecorationSet.empty;
      },
    },
  });
}

// ---- gesture driver (called by the grip NodeView) ------------------------

const DRAG_THRESHOLD = 4; // px before a press becomes a drag (else it's a click)

// Start a pointer drag from a block's grip. Listeners attach on the PRESS (before any
// move) so every pointermove is captured. The gesture ARMS only after the pointer crosses
// the threshold — a press released in place is a plain click (onEnd(false) → open menu).
// While armed we track the live drop target/zone, paint the flat affordance via plugin
// meta, and on release run the resolved gesture. onEnd(moved) lets the grip distinguish
// click from drag.
export function startBlockDrag(view, getPos, event, onEnd) {
  if (event && event.button != null && event.button !== 0) return;
  const fromStart = typeof getPos === 'function' ? getPos() : getPos;
  if (typeof fromStart !== 'number') return;

  const downX = event ? event.clientX : 0;
  const downY = event ? event.clientY : 0;
  let armed = false;
  let lastTarget = null;

  const setTarget = (target) => {
    lastTarget = target;
    view.dispatch(view.state.tr.setMeta(dragPluginKey, { active: true, fromStart, target }));
  };

  const onMove = (e) => {
    if (!armed) {
      if (Math.abs(e.clientX - downX) <= DRAG_THRESHOLD && Math.abs(e.clientY - downY) <= DRAG_THRESHOLD) return;
      armed = true;
      document.body.classList.add('wp-dragging');
    }
    if (e.cancelable) e.preventDefault(); // suppress text selection while dragging
    const hit = hitTest(view, e.clientX, e.clientY);
    setTarget(hit ? { start: hit.start, end: hit.end, zone: hit.zone, after: hit.after } : null);
  };

  const finish = (e) => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', finish, true);
    document.body.classList.remove('wp-dragging');

    if (!armed) { onEnd && onEnd(false); return; } // plain click — let the menu open

    let hit = lastTarget;
    if (!hit && e) {
      const h = hitTest(view, e.clientX, e.clientY);
      hit = h ? { start: h.start, end: h.end, zone: h.zone, after: h.after } : null;
    }
    if (hit && hit.start !== fromStart) {
      if (hit.zone === ZONE.PAIR) doPair(view, fromStart, hit);
      else if (hit.zone === ZONE.MERGE) doMerge(view, fromStart, hit);
      else if (hit.zone === ZONE.REORDER) doReorder(view, fromStart, hit);
      else clearDrag(view);
    } else {
      clearDrag(view);
    }
    view.focus();
    onEnd && onEnd(true);
  };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', finish, true);
}
