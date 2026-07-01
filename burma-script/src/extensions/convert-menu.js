import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';
import { getEpisode } from '../episode-config.js';
import { defaultDirectionMarkAttrs } from './direction-chip.js';

// ── SELECT → RIGHT-CLICK → CONVERT-TO-VIZ ────────────────────────────────────────────────────
// Palau only. Select a run of text, right-click, and get a premium floating menu that converts the
// WHOLE selection into a viz chip (highlighted directionMark run). Picking a kind applies
// setMark('directionMark', <default attrs for kind>) across the selection — the same mark the slash
// menu stores, so a converted run reads/toggles/round-trips identically to a /-typed one (archive &
// oncam get their leading ☐ checkbox, factcheck/animation/3d/broll/direction get their coloured run).
//
// It NEVER hijacks right-click when the selection is empty — the timecode chip's own right-click
// sequence menu (marks.js) and the browser's native menu both stay intact. It also bails when the
// click lands on an existing chip, so order-of-plugin-registration can't let it steal the tc menu.

// The seven convertible viz kinds, in Johnny's stated order. label = what the menu shows; kind =
// the directionMark kind. Every kind here is a key defaultDirectionMarkAttrs already understands, so
// the status default (archive→needed, factcheck→todo, …) stays in lockstep with the slash menu.
export const VIZ_KINDS = [
  { label: 'Animation',  kind: 'animation' },
  { label: '3d',         kind: '3d' },
  { label: 'B-roll',     kind: 'broll' },
  { label: 'Archive',    kind: 'archive' },
  { label: 'On cam',     kind: 'oncam' },
  { label: 'Fact-check', kind: 'factcheck' },
  { label: 'Direction',  kind: 'direction' },
];

function el(tag, cls, attrs) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

// Apply the chosen viz kind across the CURRENT (non-empty) selection. Uses the shared default-attrs
// helper so a converted run is byte-identical to one the slash menu would produce for that kind.
function convertSelection(editor, kind) {
  if (isReadOnly()) return false;
  const { from, to } = editor.state.selection;
  if (from === to) return false; // never convert an empty selection
  return editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .setMark('directionMark', defaultDirectionMarkAttrs(kind))
    .run();
}

// A single live menu instance. Rendered into <body>, positioned near the pointer, closed on Escape,
// pick, or any click/scroll/resize away from it. Fully keyboard-driven (Up/Down/Home/End/Enter/Esc).
function createConvertMenu(editor, x, y) {
  let activeIndex = 0;
  const menu = el('div', 'wp-convert-menu wp-slash-menu', { contenteditable: 'false', role: 'menu' });

  const head = el('div', 'wp-convert-head');
  head.textContent = 'Convert to viz';
  menu.appendChild(head);

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
    const item = VIZ_KINDS[index];
    if (!item) return;
    close();
    convertSelection(editor, item.kind);
    editor.view.focus();
  };

  VIZ_KINDS.forEach((item, index) => {
    const button = el('button', 'wp-convert-item wp-slash-item', {
      type: 'button',
      role: 'menuitem',
      'data-kind': item.kind,
    });
    // A tiny swatch that reads the same colour token the real chip uses (data-kind on .wp-dhl),
    // so the menu previews exactly what the conversion will look like.
    const dot = el('span', 'wp-convert-dot', { 'data-kind': item.kind });
    const label = el('span', 'wp-convert-label');
    label.textContent = item.label;
    button.appendChild(dot);
    button.appendChild(label);
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
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % VIZ_KINDS.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + VIZ_KINDS.length) % VIZ_KINDS.length; paintActive(); buttons[activeIndex].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); activeIndex = 0; paintActive(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); activeIndex = VIZ_KINDS.length - 1; paintActive(); buttons[activeIndex].focus(); }
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
              // Palau-gated: Burma keeps its native right-click untouched.
              if (getEpisode()?.id !== 'palau') return false;
              if (isReadOnly()) return false;
              // Only convert a real, non-empty text selection. Empty selection → let the timecode
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
