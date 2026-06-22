// Single source of truth for HTML-entity escaping across the Interpreter client.
//
// This is the XSS boundary every escaper in translation/src now delegates to:
//   - manual-steps.js  esc()    — the setup-checklist modal innerHTML
//   - devchat-render.js escDc()  — the public devchat message render
//   - export/pdf-export.js esc() — the highlights→PDF export window
//
// Escapes the five HTML-significant characters & < > " ' so a value can be
// safely interpolated into BOTH element text AND a double- or single-quoted
// attribute. Ampersand is replaced FIRST so the entity ampersands it emits are
// never double-escaped. A nullish input degrades to '' (never the literal
// "null"/"undefined"); a number/boolean is coerced to its string form.
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
