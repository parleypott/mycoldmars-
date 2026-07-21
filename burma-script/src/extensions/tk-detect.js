// Burma Script Tool — TK DETECT (always-on, decoration-only loose-end paint).
//
// Johnny: "Anytime I just put TK alone in text I want it to turn a little red — no
// slash needed. And it swoops in everything in parentheses around it." A bare TK or a
// '(TK …)' parenthetical wears .wp-tk-loose — a SUBTLE red (quiet nag, not the
// /pending alarm; styles.css). The same pattern makes the row a member of the TK
// workspace (workspaces.js) — BOTH read tk-pattern.js, the single source of truth,
// so the paint and the workspace can never disagree.
//
// NOTE ON THE CLASS NAME: the {tk …} bracket surface (marks.js TkSpan) already owns
// `.wp-tk` — that chip look stays untouched, so this paint wears its own class,
// `.wp-tk-loose` ("loose ends"). Text already inside a tkSpan is SKIPPED here (that
// surface has its own look; no stacking) but still counts for workspace membership.
//
// HOW: scan per-TEXTBLOCK (marks split text nodes — a parenthetical can span several
// inline fragments, so per-text-node scanning would miss it). tk-pattern.js builds
// the block's positional string (one char per doc position; non-text inline leaves
// padded), findTkRanges returns block-relative offsets, and blockStart + offset maps
// them to absolute doc positions for INLINE decorations.
//
// COLLAB LOOP LAW: this plugin dispatches NOTHING (chapter-focus.js is the template;
// row-numbers.js is the memo discipline) — it only recomputes a DecorationSet from
// the doc. Remote y-sync transactions rebuild the set (pure compute); selection-only
// transactions reuse the previous set untouched (positions can't move without
// docChanged). Builds are memoized by doc REFERENCE, so plugin init + any same-doc
// recompute share one set object and PM touches no DOM.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findTkRanges, textblockPositionalText } from '../tk-pattern.js';

export const tkDetectKey = new PluginKey('wpTkDetect');

// One textblock's decorations: the SHARED positional string (tk-pattern.js — the very
// builder the workspace membership probe reads) + tkSpan-covered ranges in the same
// block-relative offsets, then paint every TK range that doesn't touch a tkSpan.
function scanTextblock(node, blockStart, decos) {
  const s = textblockPositionalText(node);
  const spans = []; // [from, to) block-relative ranges already wearing the tkSpan chip
  node.forEach((child, offset) => {
    if (child.isText && child.marks.some((m) => m.type?.name === 'tkSpan')) {
      spans.push({ from: offset, to: offset + child.nodeSize });
    }
  });
  for (const r of findTkRanges(s)) {
    if (spans.some((sp) => r.from < sp.to && r.to > sp.from)) continue; // no stacking on {tk} chips
    decos.push(Decoration.inline(
      blockStart + r.from,
      blockStart + r.to,
      { class: 'wp-tk-loose' },
      { tkKind: r.kind }, // spec ride-along so the headless suite reads paint without DOM
    ));
  }
}

// Memoize by doc ref (row-numbers/chapter-focus discipline, one step further): the
// same doc node always yields the same set OBJECT, so PM sees identical decorations
// and touches no DOM even across plugin re-inits (episode swaps remount the editor).
const memo = new WeakMap();

// Exported for the headless suite — the full inline decoration set for a doc.
export function buildTkDecorations(doc) {
  const hit = memo.get(doc);
  if (hit) return hit;
  const decos = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    scanTextblock(node, pos + 1, decos);
    return false; // a textblock's children are inline — nothing deeper to visit
  });
  const set = decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
  memo.set(doc, set);
  return set;
}

// Exported for the headless suite (workspace-filter doctrine) — the real plugin.
export function createTkDetectPlugin() {
  return new Plugin({
    key: tkDetectKey,
    state: {
      init: (_config, state) => buildTkDecorations(state.doc),
      apply(tr, prev) {
        // Positions only move when the doc changes; selection-only transactions
        // keep the same set object (mapping would be the identity anyway).
        if (!tr.docChanged) return prev;
        return buildTkDecorations(tr.doc);
      },
    },
    props: {
      decorations(state) {
        return tkDetectKey.getState(state) || DecorationSet.empty;
      },
    },
  });
}

export const TkDetect = Extension.create({
  name: 'tkDetect',
  addProseMirrorPlugins() {
    return [createTkDetectPlugin()];
  },
});
