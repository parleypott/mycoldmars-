// Shared keyboard support for the floating .wp-blockmenu popups (the grip/block menu in blocks.js
// AND the timecode DAY menu in marks.js). L6/ux-02: both menus were mouse-only (no Escape, no focus
// management, no arrow nav). Factored here so both use ONE implementation and can't drift.

// Wire keyboard nav for an open menu element:
//   • Escape         → close (caller's onClose; caller restores focus to its anchor)
//   • ArrowUp/Down    → move focus between enabled .wp-bm-item buttons (wraps)
//   • Home/End        → first / last item
//   • Enter/Space     → handled per-item via makeItemKeyActivatable
// Focuses the first item on open (deferred a frame so the opening click doesn't steal it back).
// Returns the document-level keydown handler so the caller can detach it on close.
export function attachMenuKeynav(menu, onClose) {
  const items = () => Array.from(menu.querySelectorAll('.wp-bm-item'));
  const handler = (e) => {
    const list = items();
    if (!list.length) return;
    const idx = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); list[idx < 0 ? 0 : (idx + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[idx < 0 ? list.length - 1 : (idx - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
  };
  document.addEventListener('keydown', handler, true);
  requestAnimationFrame(() => { const f = items()[0]; if (f) f.focus(); });
  return handler;
}

// Make a menu item keyboard-activatable. Items fire on mousedown (to preserve editor selection);
// this adds Enter/Space → synthetic mousedown so a focused item activates from the keyboard too.
export function makeItemKeyActivatable(item) {
  item.setAttribute('role', 'menuitem');
  item.setAttribute('tabindex', '-1'); // focusable programmatically (arrow nav) but not in tab order
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    }
  });
}
