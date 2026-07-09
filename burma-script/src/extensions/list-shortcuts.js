// Burma Script Tool — guaranteed list keyboard shortcuts.
//
// REGRESSION FIX (Johnny 2026-07-09: "cmd+shift+8 doesn't give me bullet points anymore").
// Cmd/Ctrl+Shift+8 (bullet) and Cmd/Ctrl+Shift+7 (ordered) are supposed to arrive "for free" from
// StarterKit's BulletList / OrderedList keymaps. In the live editor the bullet chord stopped
// producing a list. A full static audit found the binding present and un-shadowed — the failure
// lives in the live editable/keymap layer (and/or the OS grabbing the physical chord), which the
// headless suite can't see. Rather than chase a live-only trigger, we bind the two shortcuts
// ourselves at a priority ABOVE Collaboration (1000) so this keymap can never be dropped,
// reordered, or shadowed. Keymap-only — no automatic transactions — so it is COLLAB LOOP LAW safe.
//
// The real robustness for the OS-grab case is the /bullet + /number slash items (slash-menu.js)
// and the bubble-menu button — a chord the OS steals can't be fixed in JS, so we give a path that
// doesn't need the chord. This rebind still guarantees the shortcut works whenever the event does
// reach the page in edit mode.
import { Extension } from '@tiptap/core';
import { isReadOnly } from '../read-mode.js';

export const ListShortcuts = Extension.create({
  name: 'listShortcuts',
  priority: 1001,

  addKeyboardShortcuts() {
    const toggle = (kind) => () => {
      if (isReadOnly()) return false;
      const view = this.editor.view;
      if (!view || !view.editable) return false; // editable is the real write gate, not just isReadOnly
      return kind === 'ordered'
        ? this.editor.chain().focus().toggleOrderedList().run()
        : this.editor.chain().focus().toggleBulletList().run();
    };
    return {
      'Mod-Shift-8': toggle('bullet'),
      'Mod-Shift-7': toggle('ordered'),
    };
  },
});
