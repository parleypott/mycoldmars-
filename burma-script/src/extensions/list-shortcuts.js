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
import { TextSelection } from '@tiptap/pm/state';
import { toggleListPreservingStyle } from './list-style-preserve.js';
import { runDownloadsHotkey } from './downloads-newest.js';

export const ListShortcuts = Extension.create({
  name: 'listShortcuts',
  priority: 1001,

  addKeyboardShortcuts() {
    // STYLE-PRESERVING (list-style-preserve.js): the wrap keeps the caret's role style so an
    // armed b-roll (or any directionMark) line stays styled after Cmd/Ctrl+Shift+8/7. Read-mode
    // and the editable write-gate are checked inside the shared helper.
    const toggle = (kind) => () => toggleListPreservingStyle(this.editor, kind);
    return {
      'Mod-Shift-8': toggle('bullet'),
      'Mod-Shift-7': toggle('ordered'),
      // DESELECT (Johnny 2026-07-22: "command d to deselect all"). Collapses any selection —
      // a text range or a selected node (image/gif) — to a caret at its head, and returning
      // true swallows the browser's native Cmd+D bookmark dialog. Collapsing is not a write,
      // so no read-mode gate; when nothing is selected it still swallows the bookmark dialog.
      'Mod-d': () => {
        const { state, view } = this.editor;
        const sel = state.selection;
        if (!sel.empty) {
          view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(sel.to))));
        }
        return true;
      },
      // STRIKETHROUGH (Johnny 2026-07-22: "command shift X doesn't strike thru"). The Strike
      // mark was schema-disabled until today; now enabled (Editor.jsx + migrate-doc mirror in
      // lockstep) and the chord is guaranteed here at priority 1001 like the list chords, so
      // no keymap reshuffle or extension-version default change can ever drop it.
      'Mod-Shift-x': () => {
        if (!this.editor.isEditable) return false;
        return this.editor.chain().focus().toggleStrike().run();
      },
      // DOWNLOADS HOTKEY (Johnny 2026-07-23, rebound off ⌘⌥M which macOS eats for minimize: "press a key, my newest download lands in the
      // script"). ⌘⌃M (Ctrl+⌘+M) grabs the NEWEST complete file in his ~/Downloads (a MapKeys .gif,
      // etc.) via the File System Access API and feeds it through the SAME media-paste pipeline a
      // clipboard paste uses — transcode/route/dedupe/413-heal/loop-controls all inherited. Bound
      // here at priority 1001 so no keymap reshuffle can shadow it. The whole async chain starts
      // INSIDE this keydown gesture so the permission prompt / directory picker is user-activated
      // (browsers require it). isEditable gate = a no-op on a ?read share. Returning true swallows
      // any browser default for the chord. Not a write here (the insert is one user transaction
      // inside startMediaPaste) → COLLAB LOOP LAW safe.
      'Mod-Ctrl-m': () => {
        if (!this.editor.isEditable) return false;
        // Call SYNCHRONOUSLY inside the keydown gesture — the File System Access permission
        // prompt/picker requires transient user activation, so we must NOT defer to a microtask.
        // The inline try/.catch just swallows a synchronous pre-try throw + async rejection so a
        // stray error can't become an unhandled rejection (review NIT 2026-07-23); the gesture
        // timing is untouched.
        try { runDownloadsHotkey(this.editor.view)?.catch(() => {}); } catch (_) { /* no-op */ }
        return true;
      },
    };
  },
});
