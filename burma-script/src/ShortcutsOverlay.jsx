// ShortcutsOverlay.jsx — the ⌘/ keyboard-shortcuts help card (night/shortcuts-overlay).
//
// The shortcuts all exist; discoverability didn't. This is READ-ONLY CHROME: it never
// touches the editor, dispatches nothing, and imports nothing from the collab or write
// paths — so it is safe in EDIT, in READ, and on ?read shares alike (COLLAB LOOP LAW
// satisfied by having no editor surface at all).
//
// Two pieces, one mount point:
//   1. a small "? keys" pill that renders wherever <ShortcutsOverlay /> is placed
//      (main.jsx puts it in the masthead meta row, next to the tips toggle), and
//   2. the card itself — PORTALED to .wp-page. Portal matters twice over: (a) the pill
//      lives inside .wp-device, which gets transform:translateX() when the outline is
//      open, and a transformed ancestor hijacks position:fixed; (b) .wp-page carries the
//      colour-scheme variables + the per-episode --ep-accent inline style, so portaling
//      THERE (not document.body) keeps the card on-theme in every scheme.
//
// Trigger: ⌘/ (Ctrl+/ elsewhere) toggles; Esc or a click on the veil closes. The Esc
// listener runs in the CAPTURE phase and calls preventDefault — the chapter-focus Esc
// handler in main.jsx treats defaultPrevented as "someone already consumed this Esc"
// (audit 2026-07-07), so closing the card never also yanks Johnny out of chapter focus.
//
// The shortcut list itself lives in shortcuts-list.js (pure data, headless-testable);
// the suite cross-checks it against the real keymap sources so this card cannot drift.

import { useState, useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { SHORTCUT_GROUPS, comboLabels, isMacPlatform } from './shortcuts-list.js';

function KeyCaps({ tokens, mac }) {
  const labels = comboLabels(tokens, mac);
  return (
    <span class="wp-keys-combo">
      {labels.map((lab, i) => (
        <span key={i} class="wp-keys-combo-part">
          {i > 0 && <span class="wp-keys-plus" aria-hidden="true">+</span>}
          <kbd class="wp-keys-cap">{lab}</kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef(null);
  const mac = isMacPlatform(
    (typeof navigator !== 'undefined' && (navigator.userAgentData?.platform || navigator.platform)) || '',
  );

  // ⌘/ toggles; Esc closes. Capture phase so our preventDefault lands BEFORE the
  // chapter-focus bubble listener checks e.defaultPrevented (see header note).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === '/') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Land keyboard focus on the close button so Esc/Enter work without a mouse trip.
  useEffect(() => {
    if (open) setTimeout(() => { try { closeRef.current?.focus(); } catch {} }, 0);
  }, [open]);

  const card = open && (
    <div class="wp-keys-veil" onClick={() => setOpen(false)}>
      <div
        class="wp-keys-card"
        role="dialog"
        aria-modal="true"
        aria-label="keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="wp-keys-head">
          <span class="wp-keys-title">the keys</span>
          <span class="wp-keys-sub">every move this page knows</span>
          <button
            ref={closeRef}
            class="wp-keys-close"
            onClick={() => setOpen(false)}
            title="Close (Esc)"
            aria-label="close the shortcuts card"
          >✕</button>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} class="wp-keys-group">
            <h3 class="wp-keys-group-lab">{group.title}</h3>
            <ul class="wp-keys-list">
              {group.items.map((item) => (
                <li key={item.does} class="wp-keys-row">
                  <span class="wp-keys-cell">
                    {item.keys
                      ? <KeyCaps tokens={item.keys} mac={mac} />
                      : <span class="wp-keys-mouse">{item.mouse}</span>}
                  </span>
                  <span class="wp-keys-does">
                    {item.does}
                    {item.edit && <span class="wp-keys-edittag" title="only in edit mode">edit</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );

  // .wp-page carries the scheme vars + --ep-accent; body is the last-resort host.
  const host = (typeof document !== 'undefined' && (document.querySelector('.wp-page') || document.body)) || null;

  return (
    <span class="wp-keys">
      <button
        class="wp-keys-pill"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        title={`Keyboard shortcuts (${mac ? '⌘' : 'Ctrl+'}/)`}
      >
        <span class="wp-keys-glyph">⌘</span>
      </button>
      {card && host && createPortal(card, host)}
    </span>
  );
}
