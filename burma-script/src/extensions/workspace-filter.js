// Burma Script Tool — WORKSPACE FILTER (the per-craft cutout view).
//
// Johnny: each craft's sections should "exist in these floating spaces… feels almost
// like a cut out". Entering a workspace (masthead WORKSPACES menu / ?ws= deep link)
// keeps the SAME editor, same doc, same collab session — this plugin only paints:
//   • wp-ws-member  — a row inside a craft section (the cutout card face)
//   • wp-ws-first / wp-ws-last — the card's OUTERMOST visible rows (rounded corners)
//   • wp-ws-context is-above/is-below — a revealed CONTEXT row: flat gray, uniform
//     opacity, no gradient/mask, inside the same card walls, pointer-events off. It
//     appears ONLY when the reader expands a card's head or tail; a card is otherwise
//     a clean STANDALONE surface with nothing half-visible around it.
//   • wp-ws-bodytop / wp-ws-bodybot — the hairline on a member row that meets context
//     (so section-own rows are unmistakably distinct from borrowed context)
//   • wp-ws-hidden — everything else (display:none), bare top-level strays included
//   • wp-ws-left   — STICKY ROWS (Johnny's Q3 answer): a row that was a member when
//     the workspace was entered stays visible after its craft surface is edited away,
//     wearing a quiet "left this workspace" tag; it only drops out on re-entry.
//     Newly-matching rows join live and GROW the snapshot.
// plus, per section, a TOP BAR (the mono meta pill "CH 03 — THE CROSSING · ROWS
// 171–191", which jumps back to that spot in the master, plus the ABOVE expand /
// collapse controls) and a BOTTOM BAR (the BELOW expand / collapse controls). The
// pill jumps via a window event main.jsx handles; the expand/collapse pills dispatch
// a workspace meta back into THIS plugin (a direct user click, decoration-only).
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING on its own (chapter-focus.js is the
// sacred template) — it maps a meta flag + a membership snapshot + a per-visit
// expansion state to decorations. Remote y-sync transactions merely rebuild the set
// (pure compute); the ONLY dispatches touching this plugin are direct user gestures —
// the Mod-A fence keystroke and the expand/collapse pill clicks — never an auto path,
// so nothing can echo. Expansion state is per-section, per-side, held for the length
// of the workspace visit and RESET on re-entry (fresh snapshot ⇒ fresh expansions).
//
// MEMBERSHIP/ENUMERATION TRUTH: workspaces.js (rowIsMember + walkRows) — the same
// functions behind the margin row numbers and the hub metrics, so the pill's row
// range, the margin number and the hub can never disagree.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { workspaceRole, rowIsMember, walkRows } from '../workspaces.js';
import { pruneChecked } from './ws-checkoff.js';

export const workspaceFilterKey = new PluginKey('wpWorkspaceFilter');

// Each expand click reveals up to this many more context rows on that side.
export const EXPAND_STEP = 3;

const EMPTY = { wsKey: null, snapshot: null, expansions: null, checked: null, decorations: DecorationSet.empty };

// Pill title clamp — the chapter title is already word-clamped at 72 by workspaces.js;
// the pill is a one-line chip, so clamp tighter (word boundary, then an ellipsis).
function pillTitle(title, max = 36) {
  let t = String(title || '').trim();
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t.toUpperCase();
}

// The section meta pill's visible text. Exported for the suite.
export function sectionLabel(section) {
  const { startIndex, endIndex, chapter } = section;
  const rows = startIndex === endIndex ? `ROW ${startIndex}` : `ROWS ${startIndex}–${endIndex}`;
  if (!chapter) return rows;
  return `CH ${chapter.ord} — ${pillTitle(chapter.title)} · ${rows}`;
}

// A section's requested expansion (rows the reader has asked for on each side).
function reqFor(expansions, id) {
  const e = expansions && id ? expansions.get(id) : null;
  return { above: (e && e.above) || 0, below: (e && e.below) || 0 };
}

// ── THE PURE CORE — classify every top-level row for a workspace. ───────────────
// snapshot   = Set<firstBlockId> of every row that has EVER been a member during this
//              activation (null = entering fresh).
// expansions = Map<sectionId, {above, below}> of requested context rows per side
//              (null/absent = no expansion; every card is a clean standalone surface).
// Returns:
//   rows      — walkRows entries + { member, left, context, contextAbove, contextBelow,
//               hidden, first, last, bodyTop, bodyBot }. first/last mark the card's
//               OUTERMOST visible rows (context or member); bodyTop/bodyBot mark the
//               member row that meets revealed context (the ownership hairline).
//   snapshot  — the (possibly grown) snapshot to carry forward
//   sections  — [{ id, startIndex, endIndex, rowCount, chapter, firstBlockId, pos,
//               cardTopPos, cardBotEndPos, aboveCount, belowCount, aboveExpanded,
//               belowExpanded }] anchored on each section's member run. startIndex/
//               endIndex stay the MEMBER row numbers (the label's row range); aboveCount/
//               belowCount are the honest "N MORE" this side can still reveal (0 ⇒ no
//               button), clamped to EXPAND_STEP; *Expanded says a COLLAPSE is offered.
// Sticky semantics: member rows are visible; a snapshot row that stopped matching is
// visible + left; a row can only be sticky if it HAS a firstBlockId (identity).
export function classifyRows(doc, roleKey, snapshot = null, expansions = null) {
  const role = workspaceRole(roleKey);
  if (!role) return { rows: [], snapshot: null, sections: [] };
  const rows = walkRows(doc).map((r) => ({
    ...r,
    member: rowIsMember(r.node, role),
    left: false,
    context: false,
    contextAbove: false,
    contextBelow: false,
    hidden: false,
    first: false,
    last: false,
    bodyTop: false,
    bodyBot: false,
  }));

  let snap = snapshot;
  if (!snap) {
    snap = new Set();
    for (const r of rows) if (r.member && r.firstBlockId) snap.add(r.firstBlockId);
  } else {
    let grown = null; // copy-on-grow — untouched recomputes reuse the same Set
    for (const r of rows) {
      if (r.member && r.firstBlockId && !snap.has(r.firstBlockId)) {
        if (!grown) grown = new Set(snap);
        grown.add(r.firstBlockId);
      } else if (!r.member && r.firstBlockId && snap.has(r.firstBlockId)) {
        r.left = true;
      }
    }
    if (grown) snap = grown;
  }

  // Contiguous VISIBLE runs (member ∪ left) → sections. Everything between two runs is
  // a GAP of hidden rows the reader can borrow from as context; nothing is shown there
  // by default — a card is a clean standalone surface until its edge is expanded.
  const runs = [];
  let open = null;
  rows.forEach((r, i) => {
    const visible = r.member || r.left;
    if (visible) {
      if (open) open.endI = i;
      else open = { startI: i, endI: i };
    } else if (open) { runs.push(open); open = null; }
  });
  if (open) runs.push(open);

  const N = rows.length;
  runs.forEach((run, k) => {
    run.id = rows[run.startI].firstBlockId || ('i' + rows[run.startI].index);
    run.req = reqFor(expansions, run.id);
    run.aboveReveal = 0;
    run.belowReveal = 0;
    run.aboveRoom = 0;
    run.belowRoom = 0;
    // The gap above run k runs from the previous run's end (or doc start) to run k's
    // start; the gap below, from run k's end to the next run's start (or doc end).
    run.gapAbove = run.startI - (k > 0 ? runs[k - 1].endI + 1 : 0);
    run.gapBelow = (k < runs.length - 1 ? runs[k + 1].startI : N) - (run.endI + 1);
  });

  // DOC-EDGE gaps have a single claimant. TOP: only run 0's above. BOTTOM: only the
  // last run's below. reveal = min(request, gapSize); the leftover is the button's room.
  if (runs.length) {
    const f = runs[0];
    f.aboveReveal = Math.min(f.req.above, f.gapAbove);
    f.aboveRoom = f.gapAbove - f.aboveReveal;
    const l = runs[runs.length - 1];
    l.belowReveal = Math.min(l.req.below, l.gapBelow);
    l.belowRoom = l.gapBelow - l.belowReveal;
  }

  // INTERNAL gaps are shared: run k reveals downward from the top of the gap, run k+1
  // reveals upward from the bottom. If both requests would overlap, CLAMP AT THE
  // MIDPOINT (each honours its own request first, then splits the remainder evenly).
  // The leftover hidden rows are the room BOTH facing buttons still offer.
  for (let k = 0; k < runs.length - 1; k++) {
    const a = runs[k];
    const b = runs[k + 1];
    const G = a.gapBelow; // === b.gapAbove
    let aBelow = Math.min(a.req.below, G);
    let bAbove = Math.min(b.req.above, G);
    if (aBelow + bAbove > G) {
      const half = Math.floor(G / 2);
      if (aBelow <= half) bAbove = G - aBelow;
      else if (bAbove <= half) aBelow = G - bAbove;
      else { aBelow = Math.ceil(G / 2); bAbove = Math.floor(G / 2); }
    }
    a.belowReveal = aBelow;
    b.aboveReveal = bAbove;
    const remaining = G - aBelow - bAbove;
    a.belowRoom = remaining;
    b.aboveRoom = remaining;
  }

  // Paint the reveals: the N rows immediately above/below a run become CONTEXT (flat
  // gray, inside the walls), the card's outermost rows take the corners, and the member
  // rows that now touch context wear the ownership hairline.
  for (const run of runs) {
    for (let j = 1; j <= run.aboveReveal; j++) {
      const r = rows[run.startI - j];
      r.context = true; r.contextAbove = true;
    }
    for (let j = 1; j <= run.belowReveal; j++) {
      const r = rows[run.endI + j];
      r.context = true; r.contextBelow = true;
    }
    rows[run.startI - run.aboveReveal].first = true;
    rows[run.endI + run.belowReveal].last = true;
    if (run.aboveReveal > 0) rows[run.startI].bodyTop = true;
    if (run.belowReveal > 0) rows[run.endI].bodyBot = true;
  }

  for (const r of rows) {
    if (!r.member && !r.left && !r.context) r.hidden = true;
  }

  const sections = runs.map((run) => {
    const firstMember = rows[run.startI];
    const topRow = rows[run.startI - run.aboveReveal];
    const botRow = rows[run.endI + run.belowReveal];
    return {
      id: run.id,
      startIndex: firstMember.index,
      endIndex: rows[run.endI].index,
      rowCount: run.endI - run.startI + 1,
      chapter: firstMember.chapter,
      firstBlockId: firstMember.firstBlockId,
      pos: firstMember.pos,
      cardTopPos: topRow.pos,
      cardBotEndPos: botRow.pos + botRow.node.nodeSize,
      aboveCount: Math.min(EXPAND_STEP, run.aboveRoom),
      belowCount: Math.min(EXPAND_STEP, run.belowRoom),
      aboveExpanded: run.aboveReveal > 0,
      belowExpanded: run.belowReveal > 0,
    };
  });

  return { rows, snapshot: snap, sections };
}

// A direct-user-click dispatch back into this plugin (decoration-only; no doc change,
// so no collab echo). The COLLAB LOOP LAW permits exactly these user gestures.
function dispatchWs(view, meta) {
  try { view.dispatch(view.state.tr.setMeta(workspaceFilterKey, meta)); } catch {}
}

function pillButton(label, blockId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wp-ws-meta-pill';
  btn.textContent = label;
  btn.title = 'Jump to this spot in the master script';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      window.dispatchEvent(new CustomEvent('wp-ws-jump', { detail: { blockId } }));
    } catch {}
  });
  return btn;
}

function expandButton(view, id, side, count) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wp-ws-expand';
  btn.textContent = `${side === 'above' ? '⌃' : '⌄'} ${count} MORE ${side === 'above' ? 'ABOVE' : 'BELOW'}`;
  btn.addEventListener('click', (e) => { e.preventDefault(); dispatchWs(view, { expand: { id, side } }); });
  return btn;
}

function collapseButton(view, id, side) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wp-ws-collapse';
  btn.textContent = 'COLLAPSE';
  btn.addEventListener('click', (e) => { e.preventDefault(); dispatchWs(view, { collapse: { id, side } }); });
  return btn;
}

// TOP BAR — one per section: the jump pill on the left, the ABOVE expand/collapse on the
// right. side:-1 sits it before the card's first visible row; the KEY carries everything
// it renders, so PM only rebuilds the DOM when the label or the offered controls change
// (direction-chip.js checkbox-key doctrine — never per y-sync).
function topBarWidget(section) {
  const label = sectionLabel(section);
  const blockId = section.firstBlockId || '';
  const key = `wstop:${section.id}:${label}:a${section.aboveCount}${section.aboveExpanded ? 'x' : ''}`;
  return Decoration.widget(
    section.cardTopPos,
    (view) => {
      const wrap = document.createElement('div');
      wrap.className = 'wp-ws-topbar';
      wrap.contentEditable = 'false';
      wrap.appendChild(pillButton(label, blockId));
      if (section.aboveCount > 0 || section.aboveExpanded) {
        const grp = document.createElement('div');
        grp.className = 'wp-ws-expand-grp';
        if (section.aboveCount > 0) grp.appendChild(expandButton(view, section.id, 'above', section.aboveCount));
        if (section.aboveExpanded) grp.appendChild(collapseButton(view, section.id, 'above'));
        wrap.appendChild(grp);
      }
      return wrap;
    },
    { side: -1, key, ignoreSelection: true, stopEvent: () => true },
  );
}

// BOTTOM BAR — the BELOW expand/collapse controls, hugging the card's lower edge. Only
// built when there is something to offer (room to expand, or an expansion to collapse).
function bottomBarWidget(section) {
  const key = `wsbot:${section.id}:b${section.belowCount}${section.belowExpanded ? 'x' : ''}`;
  return Decoration.widget(
    section.cardBotEndPos,
    (view) => {
      const wrap = document.createElement('div');
      wrap.className = 'wp-ws-botbar';
      wrap.contentEditable = 'false';
      if (section.belowCount > 0) wrap.appendChild(expandButton(view, section.id, 'below', section.belowCount));
      if (section.belowExpanded) wrap.appendChild(collapseButton(view, section.id, 'below'));
      return wrap;
    },
    { side: 1, key, ignoreSelection: true, stopEvent: () => true },
  );
}

// THE CHECK CONTROL — one per member/left row (the card faces the editor sees). It is a
// direct-user affordance that toggles this row's VIEW-LOCAL "done" state; the click
// dispatches a decoration-only meta (no doc change, so no collab echo — COLLAB LOOP LAW).
// Anchored INSIDE the row (pos+1, before the first cell) so it becomes a child of the
// position:relative .wp-trow and CSS can float it — a quiet ring at the row's right edge
// when open, a centered green ✓ medallion when done. The KEY carries the done-state so PM
// only rebuilds this widget's DOM when the check flips (checkbox-key doctrine), never per
// membership recompute. A row with no firstBlockId can't persist a check, so it gets none.
function checkControlWidget(row, isDone) {
  const id = row.firstBlockId;
  if (!id) return null;
  const key = `wscheck:${id}:${isDone ? 1 : 0}`;
  return Decoration.widget(
    row.pos + 1,
    (view) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wp-ws-check' + (isDone ? ' is-done' : '');
      btn.setAttribute('aria-pressed', isDone ? 'true' : 'false');
      btn.title = isDone
        ? 'Checked off in your workspace — click to undo (does not change the script)'
        : 'Check this row off in your workspace (does not change the script)';
      const glyph = document.createElement('span');
      glyph.className = 'wp-ws-check-glyph';
      glyph.textContent = isDone ? '✓' : '';
      btn.appendChild(glyph);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatchWs(view, { toggleCheck: { id } });
        // Nudge the hub's DONE count to recompute (a decoration-only user gesture — the
        // hub reads the plugin's checked set off the now-current editor state).
        try { window.dispatchEvent(new CustomEvent('wp-ws-checkchange')); } catch {}
      });
      return btn;
    },
    { side: -1, key, ignoreSelection: true, stopEvent: () => true },
  );
}

// Exported for the headless suite — the full decoration set + carried snapshot.
// Node-decoration classes ride in the spec ({ wsCls }) so tests read them without
// poking prosemirror-view internals; the DOM contract is the class list.
// `checked` (Set<firstBlockId>, view-local) adds wp-ws-done to a done member/left row and
// swaps its check widget to the medallion — purely paint, never a doc change.
export function buildWorkspaceDecorations(doc, roleKey, snapshot = null, expansions = null, checked = null) {
  const res = classifyRows(doc, roleKey, snapshot, expansions);
  if (!res.rows.length && !workspaceRole(roleKey)) {
    return { decorations: DecorationSet.empty, snapshot: null, sections: [] };
  }
  const isDone = (r) => !!(checked && r.firstBlockId && checked.has(r.firstBlockId));
  const decos = [];
  const byPos = new Map(res.rows.map((r) => [r.pos, r]));
  doc.forEach((child, pos) => {
    if (child.type?.name !== 'tableRow') {
      // Bare top-level strays (trailing-paragraph peace treaty, scriptStart) never
      // belong to a cutout — hide them so the gaps between cards stay clean page bg.
      decos.push(Decoration.node(pos, pos + child.nodeSize, { class: 'wp-ws-hidden' }, { wsCls: 'wp-ws-hidden' }));
      return;
    }
    const r = byPos.get(pos);
    if (!r) return;
    let cls = '';
    if (r.member || r.left) {
      cls = 'wp-ws-member';
      if (r.left) cls += ' wp-ws-left';
      if (r.first) cls += ' wp-ws-first';
      if (r.last) cls += ' wp-ws-last';
      if (r.bodyTop) cls += ' wp-ws-bodytop';
      if (r.bodyBot) cls += ' wp-ws-bodybot';
      if (isDone(r)) cls += ' wp-ws-done';
    } else if (r.context) {
      cls = 'wp-ws-context';
      if (r.contextAbove) cls += ' is-above';
      if (r.contextBelow) cls += ' is-below';
      if (r.first) cls += ' wp-ws-first';
      if (r.last) cls += ' wp-ws-last';
    } else {
      cls = 'wp-ws-hidden';
    }
    decos.push(Decoration.node(pos, pos + child.nodeSize, { class: cls }, { wsCls: cls }));
  });
  // The per-row check control rides on every member/left card face.
  for (const r of res.rows) {
    if (!(r.member || r.left)) continue;
    const w = checkControlWidget(r, isDone(r));
    if (w) decos.push(w);
  }
  for (const s of res.sections) {
    decos.push(topBarWidget(s));
    if (s.belowCount > 0 || s.belowExpanded) decos.push(bottomBarWidget(s));
  }
  return { decorations: DecorationSet.create(doc, decos), snapshot: res.snapshot, sections: res.sections };
}

// The section's flat doc range containing `pos` (Mod-A fence below), or null. Context
// rows are never selectable — the fence walks MEMBER/left runs only, exactly the runs
// classifyRows builds (expansions never change that set).
function sectionRangeAt(doc, roleKey, snapshot, pos) {
  const res = classifyRows(doc, roleKey, snapshot);
  const runs = [];
  let open = null;
  for (const r of res.rows) {
    const visible = r.member || r.left;
    if (visible) {
      const end = r.pos + r.node.nodeSize;
      if (open) open.to = end;
      else open = { from: r.pos, to: end };
    } else if (open) { runs.push(open); open = null; }
  }
  if (open) runs.push(open);
  return runs.find((run) => pos >= run.from && pos <= run.to) || null;
}

// Apply an expand/collapse gesture to the per-visit expansion Map (copy-on-write so an
// untouched state object is never mutated). Expand grows the request by EXPAND_STEP;
// classifyRows clamps it to the room actually available. Collapse zeroes that side.
function applyExpansion(prevExp, meta) {
  const m = new Map(prevExp || []);
  const info = meta.expand || meta.collapse;
  if (!info || !info.id) return m;
  const cur = m.get(info.id) || { above: 0, below: 0 };
  const next = { above: cur.above, below: cur.below };
  if (meta.expand) {
    if (info.side === 'above') next.above = cur.above + EXPAND_STEP;
    else next.below = cur.below + EXPAND_STEP;
  } else {
    if (info.side === 'above') next.above = 0;
    else next.below = 0;
  }
  m.set(info.id, next);
  return m;
}

// `store` (optional) persists the view-local check-off set: { load(wsKey) => Set,
// save(wsKey, Set) }. Absent (the headless suite's default), checks live only in plugin
// state for the session. Both sides are wrapped so a store throw can never break apply().
export function createWorkspaceFilterPlugin(store = null) {
  const loadChecked = (k) => { try { return (store && store.load && store.load(k)) || new Set(); } catch { return new Set(); } };
  const saveChecked = (k, s) => { try { if (store && store.save) store.save(k, s); } catch {} };
  return new Plugin({
    key: workspaceFilterKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(workspaceFilterKey);
        if (meta !== undefined) {
          // EXPAND / COLLAPSE — a direct user click on a card's edge control. Recompute
          // decorations against the grown/shrunk expansion state; the doc is untouched.
          if (meta && (meta.expand || meta.collapse)) {
            if (!prev.wsKey) return prev;
            const expansions = applyExpansion(prev.expansions, meta);
            const built = buildWorkspaceDecorations(tr.doc, prev.wsKey, prev.snapshot, expansions, prev.checked);
            return { wsKey: prev.wsKey, snapshot: built.snapshot, expansions, checked: prev.checked, decorations: built.decorations };
          }
          // TOGGLE CHECK — a direct user click on a row's check control. Flip this row's
          // view-local done state, persist it, repaint. Decoration-only: the doc, the
          // snapshot and the expansions are all untouched (the check is not the script).
          if (meta && meta.toggleCheck && meta.toggleCheck.id) {
            if (!prev.wsKey) return prev;
            const id = meta.toggleCheck.id;
            const checked = new Set(prev.checked || []);
            if (checked.has(id)) checked.delete(id); else checked.add(id);
            saveChecked(prev.wsKey, checked);
            const built = buildWorkspaceDecorations(tr.doc, prev.wsKey, prev.snapshot, prev.expansions, checked);
            return { wsKey: prev.wsKey, snapshot: built.snapshot, expansions: prev.expansions, checked, decorations: built.decorations };
          }
          // Enter / switch / exit. Entering (even the same key again) takes a FRESH
          // snapshot AND fresh expansions — re-entry is exactly when sticky "left" rows
          // drop out and every card returns to its clean standalone state. Checks, by
          // contrast, are DURABLE: load them from storage and PRUNE any whose row is gone.
          const wsKey = (meta && meta.key) || null;
          if (!wsKey || !workspaceRole(wsKey)) return EMPTY;
          const expansions = new Map();
          const liveIds = new Set(walkRows(tr.doc).map((r) => r.firstBlockId).filter(Boolean));
          const loaded = loadChecked(wsKey);
          const checked = pruneChecked(loaded, liveIds);
          if (checked !== loaded) saveChecked(wsKey, checked); // persist the prune
          const built = buildWorkspaceDecorations(tr.doc, wsKey, null, expansions, checked);
          return { wsKey, snapshot: built.snapshot, expansions, checked, decorations: built.decorations };
        }
        if (!prev.wsKey) return prev;
        if (!tr.docChanged) {
          // Selection-only transactions just map the existing set (PM keeps the DOM).
          const mapped = prev.decorations.map(tr.mapping, tr.doc);
          return mapped === prev.decorations ? prev : { ...prev, decorations: mapped };
        }
        // Any doc change (local keystroke OR remote y-sync) recomputes membership so
        // the cutouts, context reveals and sticky rows track the live doc. Expansions
        // and checks carry through the visit (both keyed by row identity, stale-tolerant).
        const built = buildWorkspaceDecorations(tr.doc, prev.wsKey, prev.snapshot, prev.expansions, prev.checked);
        return { wsKey: prev.wsKey, snapshot: built.snapshot, expansions: prev.expansions, checked: prev.checked, decorations: built.decorations };
      },
    },
    props: {
      decorations(state) {
        return workspaceFilterKey.getState(state)?.decorations || DecorationSet.empty;
      },
    },
  });
}

export const WorkspaceFilter = Extension.create({
  name: 'workspaceFilter',
  // The check-off store ({ load, save }) is injected by the app (Editor.jsx), bound to the
  // active episode's storage namespace. Left null (the headless suite), checks are session-only.
  addOptions() {
    return { checkStore: null };
  },
  // MOD-A FENCE (chapter-focus doctrine): with the other rows merely display:none'd,
  // a native select-all inside a cutout would grab the ENTIRE doc — one keystroke
  // could replace every hidden section. While a workspace has the screen, Cmd/Ctrl+A
  // selects the caret's own section and nothing else (and swallows the chord when the
  // caret sits outside any cutout, rather than selecting invisible content).
  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const state = this.editor.state;
        const ps = workspaceFilterKey.getState(state);
        if (!ps || !ps.wsKey) return false; // no workspace — native select-all
        const range = sectionRangeAt(state.doc, ps.wsKey, ps.snapshot, state.selection.from)
          || sectionRangeAt(state.doc, ps.wsKey, ps.snapshot, state.selection.to);
        if (!range) return true; // outside every cutout — never select hidden rows
        try {
          const sel = TextSelection.between(state.doc.resolve(range.from), state.doc.resolve(range.to));
          this.editor.view.dispatch(state.tr.setSelection(sel));
          return true;
        } catch {
          return true;
        }
      },
    };
  },
  addProseMirrorPlugins() {
    return [createWorkspaceFilterPlugin(this.options.checkStore)];
  },
});
