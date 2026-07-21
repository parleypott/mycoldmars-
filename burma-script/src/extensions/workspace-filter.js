// Burma Script Tool — WORKSPACE FILTER (the per-craft cutout view).
//
// Johnny: each craft's sections should "exist in these floating spaces… feels almost
// like a cut out". Entering a workspace (masthead WORKSPACES menu / ?ws= deep link)
// keeps the SAME editor, same doc, same collab session — this plugin only paints:
//   • wp-ws-member  — a row inside a craft section (the cutout card face)
//   • wp-ws-first / wp-ws-last — the section's outer member rows (card corners)
//   • wp-ws-ghost is-above/is-below — the ONE row hugging each section edge, faded
//     to atmosphere (CSS feathers it with a mask; pointer-events off)
//   • wp-ws-hidden — everything else (display:none), bare top-level strays included
//   • wp-ws-left   — STICKY ROWS (Johnny's Q3 answer): a row that was a member when
//     the workspace was entered stays visible after its craft surface is edited away,
//     wearing a quiet "left this workspace" tag; it only drops out on re-entry.
//     Newly-matching rows join live and GROW the snapshot.
// plus one widget per section: the floating mono meta pill ("CH 03 — THE CROSSING ·
// ROWS 171–191") that jumps back to that spot in the master script (via a window
// event main.jsx handles — the pill never touches the doc).
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING (chapter-focus.js is the sacred
// template) — it maps a meta flag + a membership snapshot to decorations. Remote
// y-sync transactions merely rebuild the set (pure compute); the only dispatches in
// this file are the Mod-A fence (direct user keystroke) — no auto-dispatch path
// exists, so it cannot echo.
//
// MEMBERSHIP/ENUMERATION TRUTH: workspaces.js (rowIsMember + walkRows) — the same
// functions behind the margin row numbers and the hub metrics, so the pill's row
// range, the margin number and the hub can never disagree.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { workspaceRole, rowIsMember, walkRows } from '../workspaces.js';

export const workspaceFilterKey = new PluginKey('wpWorkspaceFilter');

const EMPTY = { wsKey: null, snapshot: null, decorations: DecorationSet.empty };

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

// ── THE PURE CORE — classify every top-level row for a workspace. ───────────────
// snapshot = Set<firstBlockId> of every row that has EVER been a member during this
// activation (null = entering fresh). Returns:
//   rows      — walkRows entries + { member, left, ghostAbove, ghostBelow, hidden,
//               first, last } (first/last = the section's outer VISIBLE rows)
//   snapshot  — the (possibly grown) snapshot to carry forward
//   sections  — [{ startIndex, endIndex, rowCount, chapter, firstBlockId, pos }]
//               anchored on each section's FIRST visible row (indices are MASTER row
//               numbers — the same enumeration the margin numbers paint)
// Sticky semantics: member rows are visible; a snapshot row that stopped matching is
// visible + left; a row can only be sticky if it HAS a firstBlockId (identity).
export function classifyRows(doc, roleKey, snapshot = null) {
  const role = workspaceRole(roleKey);
  if (!role) return { rows: [], snapshot: null, sections: [] };
  const rows = walkRows(doc).map((r) => ({
    ...r,
    member: rowIsMember(r.node, role),
    left: false,
    ghostAbove: false,
    ghostBelow: false,
    hidden: false,
    first: false,
    last: false,
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

  // Contiguous VISIBLE runs (member ∪ left) → sections; the 1 row hugging each run
  // edge ghosts; everything else hides. A single row squeezed between two runs is
  // BOTH ghosts (is-above of the lower run, is-below of the upper) — CSS feathers
  // it from both edges.
  const sections = [];
  let open = null;
  rows.forEach((r, i) => {
    const visible = r.member || r.left;
    if (visible) {
      if (open) open.endI = i;
      else open = { startI: i, endI: i };
    } else if (open) { sections.push(open); open = null; }
  });
  if (open) sections.push(open);

  for (const s of sections) {
    rows[s.startI].first = true;
    rows[s.endI].last = true;
    const above = rows[s.startI - 1];
    if (above && !(above.member || above.left)) above.ghostAbove = true;
    const below = rows[s.endI + 1];
    if (below && !(below.member || below.left)) below.ghostBelow = true;
  }
  for (const r of rows) {
    if (!r.member && !r.left && !r.ghostAbove && !r.ghostBelow) r.hidden = true;
  }

  const sectionMeta = sections.map((s) => {
    const first = rows[s.startI];
    return {
      startIndex: first.index,
      endIndex: rows[s.endI].index,
      rowCount: s.endI - s.startI + 1,
      chapter: first.chapter,
      firstBlockId: first.firstBlockId,
      pos: first.pos,
    };
  });

  return { rows, snapshot: snap, sections: sectionMeta };
}

// One floating meta pill per section. side:-1 puts it BEFORE the section's first row;
// the KEY carries everything the pill renders, so PM only rebuilds its DOM when the
// label actually changes (direction-chip.js checkbox-key doctrine — never per y-sync).
// Clicking dispatches ONLY a window event; main.jsx exits the workspace and scrolls
// the master to the row, resolving the position by firstBlockId AT CLICK TIME.
function sectionWidget(section) {
  const label = sectionLabel(section);
  const blockId = section.firstBlockId || '';
  const key = `wsm:${blockId || 'i' + section.startIndex}:${label}`;
  return Decoration.widget(
    section.pos,
    () => {
      const wrap = document.createElement('div');
      wrap.className = 'wp-ws-meta';
      wrap.contentEditable = 'false';
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
      wrap.appendChild(btn);
      return wrap;
    },
    { side: -1, key, ignoreSelection: true, stopEvent: () => true },
  );
}

// Exported for the headless suite — the full decoration set + carried snapshot.
// Node-decoration classes ride in the spec ({ wsCls }) so tests read them without
// poking prosemirror-view internals; the DOM contract is the class list.
export function buildWorkspaceDecorations(doc, roleKey, snapshot = null) {
  const res = classifyRows(doc, roleKey, snapshot);
  if (!res.rows.length && !workspaceRole(roleKey)) {
    return { decorations: DecorationSet.empty, snapshot: null, sections: [] };
  }
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
    } else if (r.ghostAbove || r.ghostBelow) {
      cls = 'wp-ws-ghost';
      if (r.ghostAbove) cls += ' is-above';
      if (r.ghostBelow) cls += ' is-below';
    } else {
      cls = 'wp-ws-hidden';
    }
    decos.push(Decoration.node(pos, pos + child.nodeSize, { class: cls }, { wsCls: cls }));
  });
  for (const s of res.sections) decos.push(sectionWidget(s));
  return { decorations: DecorationSet.create(doc, decos), snapshot: res.snapshot, sections: res.sections };
}

// The section's flat doc range containing `pos` (Mod-A fence below), or null.
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

export function createWorkspaceFilterPlugin() {
  return new Plugin({
    key: workspaceFilterKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(workspaceFilterKey);
        if (meta !== undefined) {
          // Enter / switch / exit. Entering (even the same key again) takes a FRESH
          // snapshot — re-entry is exactly when sticky "left" rows drop out.
          const wsKey = (meta && meta.key) || null;
          if (!wsKey || !workspaceRole(wsKey)) return EMPTY;
          const built = buildWorkspaceDecorations(tr.doc, wsKey, null);
          return { wsKey, snapshot: built.snapshot, decorations: built.decorations };
        }
        if (!prev.wsKey) return prev;
        if (!tr.docChanged) {
          // Selection-only transactions just map the existing set (PM keeps the DOM).
          const mapped = prev.decorations.map(tr.mapping, tr.doc);
          return mapped === prev.decorations ? prev : { ...prev, decorations: mapped };
        }
        // Any doc change (local keystroke OR remote y-sync) recomputes membership so
        // the cutouts, ghosts and sticky rows track the live doc.
        const built = buildWorkspaceDecorations(tr.doc, prev.wsKey, prev.snapshot);
        return { wsKey: prev.wsKey, snapshot: built.snapshot, decorations: built.decorations };
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
    return [createWorkspaceFilterPlugin()];
  },
});
