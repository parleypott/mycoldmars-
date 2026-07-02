// Burma Script Tool — WP-11 PASTE SANITIZATION.
//
// Google Docs and Word are the top real-world source of formatting corruption on paste: Docs wraps
// the whole selection in a normal-weight <b style="font-weight:normal"> (so ProseMirror's Bold, which
// parses font-weight, turns everything bold), and Word injects mso-* inline styles + <o:p> cruft +
// conditional comments. We SANITIZE the clipboard HTML BEFORE ProseMirror parses it — the marks
// allowlist on every block node (blocks.js) is the schema-level backstop; this is the front door.
//
// The transforms are deliberately STRING-BASED (no DOM dependency) so the exact same code runs in the
// browser (transformPastedHTML) and headless in bun (paste-sanitize.test.mjs) — the DOM-walking
// variant would be untestable in our node test runner. ProseMirror re-parses whatever string we
// return, so we only need to hand back well-formed-enough HTML with the corrupting bits removed.
//
// Order matters: unwrap normal-weight bold FIRST (it needs the font-weight marker that step 3 strips),
// THEN strip style/class, THEN remove the now-empty spans that stripping left behind.

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

// 1. Office/Docs cruft: conditional comments, <style>/<xml>/<script> islands, <o:p> paragraphs.
export function stripOfficeCruft(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|xml|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?o:p\b[^>]*>/gi, '');
}

// 2. Unwrap normal-weight <b>/<strong> wrappers (the Google-Docs "font-weight:normal" selection
// wrapper, and the id="docs-internal-guid" outer tag) while KEEPING genuine bold. A stack scan pairs
// each open with its matching close so nested REAL bold survives and only the normal-weight tags are
// removed — correct even when a real bold sits inside the Docs wrapper.
export function unwrapNormalBold(html) {
  const tokenRe = /<(\/?)(b|strong)\b([^>]*)>/gi;
  let result = '';
  let last = 0;
  const stack = [];
  let m;
  while ((m = tokenRe.exec(html)) !== null) {
    const [full, slash, , attrs] = m;
    result += html.slice(last, m.index);
    last = m.index + full.length;
    if (!slash) {
      const isNormal = /font-weight\s*:\s*(?:normal|400)\b/i.test(attrs)
        || /\bid\s*=\s*["']?docs-internal-guid/i.test(attrs);
      stack.push(isNormal);
      if (!isNormal) result += full; // keep the open tag of genuine bold
    } else {
      const drop = stack.length ? stack.pop() : false;
      if (!drop) result += full; // keep the matching close of genuine bold
    }
  }
  result += html.slice(last);
  return result;
}

// 3. Strip presentational/locale attributes that only carry paste noise. style/class are the corruptors
// (mso-*, font-weight, background washes); lang/dir just clutter. We never strip data-* (our chips,
// timecodes, flavors ride there) or semantic tags.
export function stripStyleAndClass(html) {
  return html
    .replace(/\s(?:style|class|lang|dir|align)\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(?:style|class|lang|dir|align)\s*=\s*'[^']*'/gi, '');
}

// 4. Remove spans left empty (Docs emits a <span> per run; stripping styles empties many). Loop until
// stable so nested empties collapse. Only bare <span> — never a data-* span (chip/timecode/flavor).
export function removeEmptySpans(html) {
  let prev;
  let out = html;
  do {
    prev = out;
    out = out.replace(/<span(?![^>]*\sdata-)[^>]*>\s*<\/span>/gi, '');
  } while (out !== prev);
  return out;
}

export function sanitizePastedHTML(html) {
  if (typeof html !== 'string' || !html) return html;
  let out = stripOfficeCruft(html);
  out = unwrapNormalBold(out);   // BEFORE stripStyleAndClass — needs the font-weight marker
  out = stripStyleAndClass(out);
  out = removeEmptySpans(out);
  return out;
}

// Plaintext paste: normalize Windows CRLF and non-breaking spaces so a pasted plain line reads as
// clean script text. Leave everything else for ProseMirror's own text handling.
export function sanitizePastedText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
}

// The extension: transformPastedHTML/transformPastedText run on EVERY paste. Cmd/Ctrl+Shift+V arms a
// one-shot PLAIN paste — the next paste inserts only text/plain, dropping all formatting (the
// "paste without formatting" a writer between shoots expects). handleKeyDown arms; handlePaste
// consumes. We disarm on a short timer as a safety valve if no paste follows.
export const PasteSanitize = Extension.create({
  name: 'pasteSanitize',
  addProseMirrorPlugins() {
    let plainArmed = false;
    let disarmTimer = null;
    const disarm = () => { plainArmed = false; if (disarmTimer) { clearTimeout(disarmTimer); disarmTimer = null; } };
    return [new Plugin({
      props: {
        transformPastedHTML: (html) => sanitizePastedHTML(html),
        transformPastedText: (text) => sanitizePastedText(text),
        handleKeyDown: (_view, event) => {
          const key = (event.key || '').toLowerCase();
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'v') {
            plainArmed = true;
            if (disarmTimer) clearTimeout(disarmTimer);
            disarmTimer = setTimeout(disarm, 500);
            // Do NOT preventDefault — let the browser's paste fire; handlePaste below consumes it.
          }
          return false;
        },
        handlePaste: (view, event) => {
          if (!plainArmed) return false;
          disarm();
          const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
          if (!text) return false;
          const clean = sanitizePastedText(text);
          view.dispatch(view.state.tr.insertText(clean).scrollIntoView());
          if (event.preventDefault) event.preventDefault();
          return true;
        },
      },
    })];
  },
});
