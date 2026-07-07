// CMD+K HYPERLINKS. StarterKit v3 already registers the `link` mark in the schema (and the
// MARKS_ALLOWLIST in blocks.js now admits it inside every script block) — what was missing
// is the GESTURE. This extension binds Mod-K:
//
//   • selection (or caret inside an existing link) → prompt for the URL, prefilled with the
//     current href when editing. House style: window.prompt, same as the archive-path editor.
//   • empty/cleared input → the link is REMOVED from the whole run (extendMarkRange).
//   • a bare "example.com" gets https:// prepended so hrefs are always openable.
//   • caret with no selection and no link under it → quiet error toast, nothing changes.
//
// Opening links while editing: Cmd/Ctrl+CLICK opens in a new tab (a plain click just places
// the caret, so writing near a link never yanks the tab away). In the read-only share the
// anchors are native links — the browser opens them like any page.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { isReadOnly } from '../read-mode.js';

// Pure href normalizer, exported for the headless suite: trim; empty stays empty; keep any
// explicit scheme (https:, mailto:, …); everything else gets https://.
export function normalizeHref(raw) {
  const url = String(raw == null ? '' : raw).trim();
  if (!url || url === 'https://') return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
}

export const LinkKeymap = Extension.create({
  name: 'linkKeymap',

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (isReadOnly()) return false;
        const editor = this.editor;
        const current = editor.getAttributes('link')?.href || '';
        if (editor.state.selection.empty && !current) {
          window.dispatchEvent(new CustomEvent('wp-toast', {
            detail: { tone: 'error', msg: 'select the words to link first' },
          }));
          return true;
        }
        const raw = window.prompt('Link URL', current || 'https://');
        if (raw == null) return true; // cancelled — nothing changes
        const href = normalizeHref(raw);
        if (!href) {
          editor.chain().focus().extendMarkRange('link').unsetMark('link').run();
          return true;
        }
        editor.chain().focus().extendMarkRange('link').setMark('link', { href }).run();
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    if (isReadOnly()) return []; // read-only anchors are natively clickable — no plugin needed
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;
            const a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!a) return false;
            try { window.open(a.href, '_blank', 'noopener'); } catch {}
            return true;
          },
        },
      }),
    ];
  },
});
