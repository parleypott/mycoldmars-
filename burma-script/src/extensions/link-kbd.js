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

// Schemes that execute script / smuggle markup when a stored href is later rendered as a raw
// <a href> — javascript:, data:, vbscript:. TipTap's render-time isAllowedUri blanks these
// TODAY (edit view AND the read-only share), but the doc should never PERSIST an executable
// href in the first place: the moment ANY consumer reads the stored href outside that one
// sanitizer (a worklist/HTML export, a future "copy link", a renderer swap) it becomes live.
// Block them at the input gate. Mirrors the browser URL parse — tab/newline/CR are stripped
// anywhere and leading whitespace is ignored before the scheme is read, so `java\tscript:`,
// ` javascript:`, and `JavaScript:` are all caught, not just the clean lowercase form.
const DANGEROUS_SCHEME_RE = /^(?:javascript|data|vbscript)$/i;
export function isDangerousUrl(raw) {
  const s = String(raw == null ? '' : raw).replace(/[\t\n\r]/g, '');
  const m = /^\s*([a-z][a-z0-9+.-]*):/i.exec(s);
  return !!m && DANGEROUS_SCHEME_RE.test(m[1]);
}

// Pure href normalizer, exported for the headless suite: trim; empty stays empty; a dangerous
// scheme (javascript:/data:/vbscript:) is REJECTED to '' (→ remove the link, never persist it);
// keep any other explicit scheme (https:, mailto:, tel:, …); everything else gets https://.
export function normalizeHref(raw) {
  const url = String(raw == null ? '' : raw).trim();
  if (!url || url === 'https://') return '';
  if (isDangerousUrl(url)) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url;
}

// Recognizes "the clipboard is a single URL" for the paste-to-link gesture: an explicit scheme
// (https://, mailto:, tel:, …) with no embedded whitespace, or a bare host typed by hand
// (example.com, www.nytimes.com/2024/07/09/world/story.html). Whitespace anywhere fails — that's
// what stops the check from firing on ordinary prose that merely CONTAINS a URL.
const BARE_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#]\S*)?$/i;
export function isSingleUrl(raw) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t || /\s/.test(t)) return false;
  if (isDangerousUrl(t)) return false; // never wrap a selection in a javascript:/data:/vbscript: link
  if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(t)) return true; // explicit scheme incl. mailto:/tel:
  return BARE_HOST_RE.test(t);
}

// Pure core of the paste-to-link gesture, factored out of handlePaste for the headless suite
// (no DOM/clipboardData dependency) — same reason normalizeHref is a pure export above. Wraps the
// CURRENT selection in a link mark; never touches the text. Returns null (no-op) when the
// selection is empty, the clipboard text isn't a single URL, or there's no link mark in the
// schema — the caller returns false so the default paste proceeds normally.
export function linkPasteTransaction(state, text) {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  if (!isSingleUrl(text)) return null;
  const href = normalizeHref(text);
  if (!href) return null;
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  return state.tr.addMark(from, to, linkType.create({ href }));
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
        // Open the inline popover (LinkPopover.jsx) instead of window.prompt — it reads the live
        // selection off editor.state itself, so no state has to cross this boundary.
        window.dispatchEvent(new CustomEvent('wp-link-open'));
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
          // PASTE-TO-LINK: registered AFTER PasteSanitize in Editor.jsx's extensions array —
          // ProseMirror's someProp('handlePaste', …) runs plugins in that order and stops at the
          // first `true`. PasteSanitize's handlePaste only returns true for the Cmd+Shift+V
          // "paste without formatting" gesture (plainArmed); on a normal paste it returns false
          // and falls through to us. So plain-paste always wins over link-wrapping, no coupling.
          handlePaste(view, event) {
            if (!view.editable || isReadOnly()) return false;
            const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
            if (!text) return false;
            const tr = linkPasteTransaction(view.state, text);
            if (!tr) return false;
            view.dispatch(tr.scrollIntoView());
            if (event.preventDefault) event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});
