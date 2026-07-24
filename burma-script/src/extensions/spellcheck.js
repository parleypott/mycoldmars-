// Burma Script Tool — CUSTOM SPELLCHECK MENU.
//
// THE PROBLEM (Johnny 2026-07): right-clicking a MISSPELLED word never surfaced spellcheck. Two
// menus fought over the right-click: the timecode retro-convert handler (marks.js) preventDefaulted
// on ANY plain-word right-click whenever a dead timecode existed doc-wide — popping "TIMECODES /
// Convert all timecodes in script" — which also killed Chrome's native spellcheck menu. This
// extension takes over: right-click a MISSPELLED word → a flat custom menu of ≤5 suggestions +
// "Add to dictionary" + "Ignore". Click a suggestion → the word is replaced in ONE transaction.
//
// WIRING (why it works): registered BEFORE ...BURMA_MARKS in Editor.jsx so its contextmenu handler
// gets first crack at the empty-selection right-click (ProseMirror runs handleDOMEvents in plugin
// order until one returns true). marks.js's retro-convert trigger was ALSO narrowed to fire only on
// a coded ROW, so when this handler steps aside the browser native menu — not the timecode menu —
// appears. The three outcomes:
//   • misspelled + suggestions → preventDefault + our flat menu (return true)
//   • misspelled + NO suggestion → return false, NO preventDefault → Chrome native menu (fallback)
//   • correct word / empty area / personal-dict name → return false → native, no takeover
// Never a dead end, never the timecode menu on a plain word.
//
// ENGINE: real Hunspell (nspell + dictionary-en) lives in the LAZY spellcheck-engine.js chunk,
// warmed in the background on mount so the right-click decision is synchronous (a right-click can't
// await — preventDefault must be decided now). Until warm completes the first clicks fall through
// to native, self-healing. Personal dictionary is namespaced localStorage, never the doc.
//
// COLLAB-SAFE: the replace is exactly ONE user-initiated transaction (buildReplaceTr). No reactive
// appendTransaction, no plugin state, nothing that dispatches on its own — so nothing can echo-loop
// under Yjs. Spell-checking and building the menu never mutate the doc.

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { setEditMode } from '../edit-mode.js';
import { attachMenuKeynav, makeItemKeyActivatable } from './menu-kbd.js';
import { inlineTextMap } from './marks.js';
import { resolveWord, spellDecision, buildReplaceTr } from './spellcheck-core.js';

// ── LAZY ENGINE WARM ────────────────────────────────────────────────────────────────────────────
// The engine chunk (nspell + dictionary) is fetched once, in the background, so the contextmenu
// handler can consult it synchronously. If a right-click lands before warm finishes, the handler
// returns false (native menu) and kicks off the warm — the next click works.
let engineMod = null;
let warming = false;
async function warmEngine() {
  if (engineMod || warming) return;
  warming = true;
  try {
    const m = await import('./spellcheck-engine.js');
    await m.getSpeller();
    engineMod = m;
  } catch (err) {
    console.warn('[spellcheck] engine load failed:', err);
  } finally {
    warming = false;
  }
}

// ── SINGLE OPEN MENU ─────────────────────────────────────────────────────────────────────────────
// One flat .wp-blockmenu at a time (mirrors marks.js openTcMenu machinery, kept local so the two
// don't share mutable state). Session-only ignore set: "Ignore" suppresses re-flagging a word for
// the rest of the session without persisting it as correct.
let openEl = null;
let openKeydown = null;
let openReposition = null;
let openReturnFocus = null;
const sessionIgnore = new Set();

function closeMenu() {
  if (!openEl) return;
  openEl.remove();
  openEl = null;
  document.removeEventListener('mousedown', onDocDown, true);
  if (openReposition) {
    window.removeEventListener('scroll', openReposition, true);
    window.removeEventListener('resize', openReposition);
    openReposition = null;
  }
  if (openKeydown) {
    document.removeEventListener('keydown', openKeydown, true);
    openKeydown = null;
  }
  const back = openReturnFocus;
  openReturnFocus = null;
  try { if (back && back.focus) back.focus(); } catch {}
}

function onDocDown(e) {
  if (openEl && !openEl.contains(e.target)) closeMenu();
}

// Build + place the flat suggestion menu. `resolved` is { word, wordFrom, wordTo }; `sugg` is the
// ≤5 suggestion strings; `event` positions it at the pointer.
function openSpellMenu(view, resolved, sugg, event) {
  closeMenu();
  const { word, wordFrom, wordTo } = resolved;

  const menu = document.createElement('div');
  menu.className = 'wp-blockmenu wp-spellmenu';
  menu.setAttribute('contenteditable', 'false');
  menu.setAttribute('role', 'menu');

  const head = document.createElement('div');
  head.className = 'wp-bm-head';
  head.textContent = 'Spelling';
  menu.appendChild(head);

  // Arm EDIT if the surface is only-read (setEditMode flips view.editable synchronously); a
  // structural block (?read share, unsynced collab) stays non-editable → refuse the write. Mirrors
  // patchTimecodeAt's reaching-for-the-pen rule.
  const armEdit = () => {
    if (!view.editable) { try { setEditMode(true); } catch {} }
    return view.editable;
  };

  for (const s of sugg) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'wp-bm-item';
    item.textContent = s;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (armEdit()) {
        const tr = buildReplaceTr(view.state, wordFrom, wordTo, word, s);
        if (tr) view.dispatch(tr);
      }
      closeMenu();
      view.focus();
    });
    makeItemKeyActivatable(item);
    menu.appendChild(item);
  }

  const sep = document.createElement('div');
  sep.className = 'wp-bm-sep';
  menu.appendChild(sep);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'wp-bm-item';
  add.textContent = 'Add to dictionary';
  add.addEventListener('mousedown', (e) => {
    e.preventDefault();
    // Personal-dict write is localStorage-only (never the doc), but it is still an authoring
    // action — gate on editable like the replace so a ?read recipient can't grow the dictionary.
    if (armEdit() && engineMod) { try { engineMod.addToPersonalDict(word); } catch {} }
    closeMenu();
    view.focus();
  });
  makeItemKeyActivatable(add);
  menu.appendChild(add);

  const ignore = document.createElement('button');
  ignore.type = 'button';
  ignore.className = 'wp-bm-item';
  ignore.textContent = 'Ignore';
  ignore.addEventListener('mousedown', (e) => {
    e.preventDefault();
    sessionIgnore.add(word.toLowerCase());
    closeMenu();
    view.focus();
  });
  makeItemKeyActivatable(ignore);
  menu.appendChild(ignore);

  document.body.appendChild(menu);
  menu.style.position = 'fixed';
  const anchorX = event.clientX;
  const anchorY = event.clientY;
  const place = () => {
    menu.style.top = `${anchorY + 4}px`;
    menu.style.left = `${anchorX}px`;
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - r.width - 8)}px`;
    if (r.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, anchorY - r.height - 4)}px`;
  };
  place();

  openEl = menu;
  openReposition = place;
  openReturnFocus = (typeof document !== 'undefined') ? document.activeElement : null;
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  openKeydown = attachMenuKeynav(menu, closeMenu);
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);
}

// Resolve the word under a doc position using marks.js's inlineTextMap (paragraph flatten). Kept
// here (not in core) because it touches the live PM doc; the pure index/position math is core's
// resolveWord.
function resolveWordAt(state, pos) {
  let $p;
  try { $p = state.doc.resolve(pos); } catch { return null; }
  if (!$p.parent.isTextblock) return null;
  const { text, posOf } = inlineTextMap(state, $p.start(), $p.end());
  return resolveWord(text, posOf, pos);
}

export const Spellcheck = Extension.create({
  name: 'spellcheck',

  onCreate() {
    // Warm the engine chunk in the background so the first real right-click is already synchronous.
    // Skip in structural read shares — the custom menu never mounts there (native handles it).
    if (!isReadOnly()) warmEngine();
  },

  addProseMirrorPlugins() {
    // A structural ?read share never gets the custom menu or the replace path — its right-click
    // yields straight to the browser native menu. (The plugin still mounts so a later sticky
    // edit-toggle isn't required; the handler bails on isReadOnly per event.)
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            contextmenu: (view, event) => {
              // ?read share OR sticky read mode → don't take over; let native/timecode-narrowed
              // menu through. Showing suggestions is moot when we can't replace anyway.
              if (isReadOnly() || !view.editable) return false;
              // Never steal a right-click that landed ON a chip (timecode / legacy dchip) — that chip
              // owns its own context menu (marks.js), which runs after us. Mirrors convert-menu.js.
              const onChip = event.target && event.target.closest
                ? event.target.closest('span.wp-tc-tag, span[data-tc], span[data-dchip]')
                : null;
              if (onChip) return false;
              // Engine not warm yet → yield to native, warm for next time. Never a dead end.
              if (!engineMod) { warmEngine(); return false; }
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!coords) return false;
              const resolved = resolveWordAt(view.state, coords.pos);
              if (!resolved) return false; // empty area / not on a word
              const { word } = resolved;
              if (!engineMod.shouldCheck(word)) return false;
              if (sessionIgnore.has(word.toLowerCase())) return false;
              const misspelled = engineMod.isMisspelled(word);
              const sugg = misspelled ? engineMod.suggestions(word) : [];
              const decision = spellDecision(misspelled, sugg.length);
              if (decision !== 'custom') return false; // correct, or no suggestion → native fallback
              event.preventDefault();
              openSpellMenu(view, resolved, sugg, event);
              return true;
            },
          },
        },
      }),
    ];
  },
});
