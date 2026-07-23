// shortcuts-list.js — the data behind the ⌘/ shortcuts card (ShortcutsOverlay.jsx).
//
// PURE MODULE, NO DOM — the overlay renders this list; the headless suite
// (shortcuts-overlay.test.mjs) imports it directly and cross-checks every binding
// against the real keymap source files, so the card can never drift from the code.
//
// Every entry here is VERIFIED against a real binding:
//   Tab / Shift+Tab   → extensions/table.js addKeyboardShortcuts (doCellHop ±1)
//   ⌘F                → FindReplace.jsx window keydown (metaKey/ctrlKey + 'f')
//   ⌘K                → extensions/link-kbd.js 'Mod-k'
//   ⌘Z / ⌘⇧Z          → StarterKit undoRedo (Editor.jsx) / collab Y.UndoManager
//   /                 → extensions/slash-menu.js Suggestion char '/' (startOfLine: false)
//   Esc               → main.jsx chapter-focus exit + every floating menu's close
//   ⌘/                → ShortcutsOverlay.jsx itself
// Mouse rows mirror the shipped affordances (marks.js timecode copy, blocks.js ⛶
// focus button, table.js row-bookmark menu, main.jsx READ/EDIT ModeToggle).
//
// Copy voice: plain words, lowercase-friendly, no jargon — Johnny is dyslexic and
// this card exists so he never has to remember anything.

// ── platform ──────────────────────────────────────────────────────────────────────────
export function isMacPlatform(platform) {
  return /mac|iphone|ipad|ipod/i.test(String(platform || ''));
}

// One key token → what the <kbd> cap shows. 'Mod' is the only platform-dependent token.
export function keyLabel(token, mac) {
  if (token === 'Mod') return mac ? '⌘' : 'Ctrl';
  if (token === 'Shift') return mac ? '⇧' : 'Shift';
  if (token === 'Alt') return mac ? '⌥' : 'Alt';
  if (token === 'Ctrl') return mac ? '⌃' : 'Ctrl';
  return token; // Tab, Esc, '/', single letters — shown as written
}

// ['Mod','K'] → ['⌘','K'] (mac) / ['Ctrl','K'] (everyone else)
export function comboLabels(tokens, mac) {
  return tokens.map((t) => keyLabel(t, mac));
}

// ── the card ──────────────────────────────────────────────────────────────────────────
// keys  = array of key tokens pressed together (rendered as flat key caps).
// mouse = a pointer gesture instead of keys (rendered as a small mono chip).
// edit  = true when the move only does something with the EDIT switch flipped on.
export const SHORTCUT_GROUPS = [
  {
    title: 'move around',
    items: [
      { keys: ['Tab'], does: 'hop to the next cell in a split row' },
      { keys: ['Shift', 'Tab'], does: 'hop back to the cell before' },
      { keys: ['Mod', 'F'], does: 'find any word in the script — and replace it in edit' },
      { keys: ['Esc'], does: 'leave chapter focus, or close whatever menu is open' },
    ],
  },
  {
    title: 'write',
    items: [
      { keys: ['/'], does: 'open the block menu — chapter, scene, vo, marks', edit: true },
      { keys: ['Mod', 'K'], does: 'turn the selected words into a link', edit: true },
      { keys: ['Mod', 'Ctrl', 'M'], does: 'drop in your newest download — the last gif or clip you saved', edit: true },
      { keys: ['Mod', 'Z'], does: 'undo your last change', edit: true },
      { keys: ['Mod', 'Shift', 'Z'], does: 'put it back', edit: true },
    ],
  },
  {
    title: 'with the mouse',
    items: [
      { mouse: 'click a timecode', does: 'copies it to your clipboard' },
      { mouse: 'READ / EDIT switch up top', does: 'every visit starts safe in read — flip it to type' },
      { mouse: '⛶ on a chapter', does: 'opens just that chapter full screen — Esc brings you back' },
      { mouse: 'right-click the ⊟ box', does: 'plants a ⚑ bookmark and copies a link to that row' },
    ],
  },
  {
    title: 'this card',
    items: [
      { keys: ['Mod', '/'], does: 'open or close this card' },
    ],
  },
];
