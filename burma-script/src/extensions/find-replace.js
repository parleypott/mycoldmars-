// Find & Replace — a ProseMirror plugin that HIGHLIGHTS matches with Decorations (never mutates the
// doc to paint them) and drives replace through the editor's NORMAL transaction path (so undo works
// and the autosave/backup listeners fire exactly as they do for any keystroke). This adds NO schema —
// it decorates existing text nodes and replaces via tr.insertText — so it does NOT touch the mirror
// schema (migrate-doc.js) or the per-block marks allowlist (blocks.js). See Editor.jsx ~352.
//
// Matching is per-TEXTBLOCK over node.textContent, so a match survives inline marks splitting a word
// (bold in the middle of a run). It does NOT span across block boundaries — a single search term is
// found within one paragraph/heading/cell body. Case-insensitive by default; a caseSensitive flag
// makes it exact. Non-overlapping, left-to-right.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const findReplaceKey = new PluginKey('burmaFindReplace');

const EMPTY = { query: '', caseSensitive: false, matches: [], current: 0 };

// Escape regex metacharacters so a query is always matched as a LITERAL string (the case-insensitive
// path below runs it through RegExp; the case-sensitive path uses indexOf, which is literal already).
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Pure: collect every non-overlapping match of `query` in the doc as {from,to} doc positions.
// Walks textblocks and maps textContent offsets to absolute positions (pos+1 enters the block).
//
// Offset correctness: matching MUST happen in the ORIGINAL text's coordinate space, because the
// {from,to} we push are original-doc positions the decorations paint and `replaceCurrentTr` splices.
// The old case-insensitive path lowercased the whole text and ran indexOf on THAT — but
// String.toLowerCase can CHANGE LENGTH (e.g. 'İ' U+0130 → 'i̇', 1 char → 2), so every offset after
// such a character drifted, and `to = from + query.length` over-selected when the matched substring's
// original width differed from the query's. Both corrupt the replace range. We now use a literal-escaped
// case-insensitive regex, which reports m.index and m[0].length in the ORIGINAL string — offset-exact
// regardless of case-folding length changes. For ASCII / normal content this is byte-identical to the
// old behavior.
export function computeMatches(doc, query, caseSensitive = false) {
  const matches = [];
  if (!doc || !query) return matches;
  const len = query.length;
  if (!len) return matches;
  const re = caseSensitive ? null : new RegExp(escapeRegExp(query), 'gi');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true; // recurse into wrappers (rows, cells, the doc)
    const text = node.textContent;
    if (!text) return false;
    if (caseSensitive) {
      let idx = 0;
      while ((idx = text.indexOf(query, idx)) !== -1) {
        const from = pos + 1 + idx;
        matches.push({ from, to: from + len });
        idx += len; // non-overlapping
      }
    } else {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const mlen = m[0].length;
        const from = pos + 1 + m.index;
        matches.push({ from, to: from + mlen });
        // Advance past this match (non-overlapping). Guard the degenerate zero-length case so a
        // pathological match can never spin the loop (query is non-empty, so mlen is normally > 0).
        re.lastIndex = mlen === 0 ? m.index + 1 : m.index + mlen;
      }
    }
    return false; // a textblock's inline children are already covered by textContent
  });
  return matches;
}

// Clamp/normalize a current-match index against the match list length.
export function clampCurrent(current, length) {
  if (length <= 0) return 0;
  let c = current % length;
  if (c < 0) c += length;
  return c;
}

// Read the live find state off an editor (for the panel's match count / current index).
export function getFindState(editor) {
  try { return findReplaceKey.getState(editor.state) || EMPTY; } catch { return EMPTY; }
}

// Build a transaction that replaces the CURRENT match with `replaceText` (or null if no match).
// Exported so the command AND the test drive the exact same production code. Goes through the
// normal transaction path (insertText) — undoable, autosaved, no direct storage write.
export function replaceCurrentTr(state, replaceText) {
  const s = findReplaceKey.getState(state);
  if (!s || !s.matches.length) return null;
  const m = s.matches[clampCurrent(s.current, s.matches.length)];
  if (!m) return null;
  const tr = state.tr.insertText(String(replaceText ?? ''), m.from, m.to);
  tr.setMeta(findReplaceKey, {}); // apply() recomputes matches on the resulting docChanged
  return tr;
}

// Build a SINGLE transaction that replaces ALL matches (right-to-left so earlier positions stay
// valid). One undo step. Returns null if there are no matches.
export function replaceAllTr(state, replaceText) {
  const s = findReplaceKey.getState(state);
  if (!s || !s.matches.length) return null;
  const tr = state.tr;
  const ordered = [...s.matches].sort((a, b) => b.from - a.from);
  for (const m of ordered) tr.insertText(String(replaceText ?? ''), m.from, m.to);
  tr.setMeta(findReplaceKey, {});
  return tr;
}

// Build the find-replace ProseMirror plugin. Exported so tests can mount it on a bare EditorState.
export function buildFindReplacePlugin() {
  return makePlugin();
}

function makePlugin() {
  return new Plugin({
    key: findReplaceKey,
    state: {
      init() { return EMPTY; },
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(findReplaceKey);
        let next = meta ? { ...value, ...meta } : value;
        // Recompute matches when the query is active AND either the doc changed (a replace/edit
        // landed) or the query/case toggled via meta. Otherwise keep the prior match set as-is
        // (cheap — no full-doc scan on unrelated selection transactions).
        if (next.query) {
          if (meta || tr.docChanged) {
            const matches = computeMatches(newState.doc, next.query, next.caseSensitive);
            next = { ...next, matches, current: clampCurrent(next.current, matches.length) };
          }
        } else if (value.matches.length || value.query) {
          next = { ...next, matches: [], current: 0 };
        }
        return next;
      },
    },
    props: {
      decorations(state) {
        const s = findReplaceKey.getState(state);
        if (!s || !s.matches.length) return DecorationSet.empty;
        const decos = s.matches.map((m, i) => Decoration.inline(m.from, m.to, {
          class: i === s.current ? 'wp-find-hit is-current' : 'wp-find-hit',
        }));
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export const FindReplace = Extension.create({
  name: 'burmaFindReplace',

  addProseMirrorPlugins() {
    return [makePlugin()];
  },

  addCommands() {
    return {
      // Set / update the active search. Resets current to 0 so the first hit is selected.
      setFindQuery: (query, caseSensitive = false) => ({ state, dispatch }) => {
        if (dispatch) {
          dispatch(state.tr.setMeta(findReplaceKey, { query: query || '', caseSensitive: !!caseSensitive, current: 0 }));
        }
        return true;
      },
      // Clear the search (drops all highlights).
      clearFind: () => ({ state, dispatch }) => {
        if (dispatch) dispatch(state.tr.setMeta(findReplaceKey, { query: '', matches: [], current: 0 }));
        return true;
      },
      // Move to the next / previous match and scroll+select it so the current highlight is visible.
      findNext: () => ({ state, dispatch }) => moveCurrent(state, dispatch, +1),
      findPrev: () => ({ state, dispatch }) => moveCurrent(state, dispatch, -1),
      // Replace the CURRENT match with `replaceText` via a normal transaction (undoable, autosaved).
      replaceCurrent: (replaceText) => ({ state, dispatch, editor }) => {
        if (editor && editor.isEditable === false) return false; // read-only: never replace
        const tr = replaceCurrentTr(state, replaceText);
        if (!tr) return false;
        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
      },
      // Replace ALL matches in a SINGLE transaction (one undo step). Right-to-left so earlier
      // positions stay valid as we splice.
      replaceAll: (replaceText) => ({ state, dispatch, editor }) => {
        if (editor && editor.isEditable === false) return false;
        const tr = replaceAllTr(state, replaceText);
        if (!tr) return false;
        if (dispatch) dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

// Shared next/prev: advance the current index and put the selection on that match so the browser
// scrolls it into view (and the decoration repaints it as the active hit).
function moveCurrent(state, dispatch, dir) {
  const s = findReplaceKey.getState(state);
  if (!s || !s.matches.length) return false;
  const nextIdx = clampCurrent(s.current + dir, s.matches.length);
  if (dispatch) {
    const m = s.matches[nextIdx];
    const tr = state.tr.setMeta(findReplaceKey, { current: nextIdx });
    try {
      if (m) tr.setSelection(TextSelection.create(tr.doc, m.from, m.to));
    } catch {}
    dispatch(tr.scrollIntoView());
  }
  return true;
}
