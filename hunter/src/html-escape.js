// HTML escaper for The Hunter's innerHTML string-building.
//
// WHY THIS EXISTS (and why it's not the old DOM trick)
// main.js previously escaped via `div.textContent = str; return div.innerHTML`.
// That escapes & < > but does NOT escape quotes — and escHtml is used in
// ATTRIBUTE contexts (`href="${escHtml(url)}"`, `src="...${escHtml(videoId)}..."`,
// `class="...--${escHtml(level)}"`). A value carrying a double-quote (a stored
// source_ref URL, a model-generated potential level) breaks out of the attribute;
// since < and > were escaped you couldn't open a NEW tag, but attribute breakout
// alone lets you graft an event handler onto the SAME tag (`x" onmouseover=...`).
// That's a real attribute-injection XSS. translation/src/main.js already used the
// 5-char regex escaper; this was the surviving divergent-weaker copy.
//
// This DOM-free regex form escapes all five HTML-significant chars, is identical
// to the old DOM output for the &<> text case (& is escaped first, so no
// double-escaping), preserves the old `str || ''` falsy handling byte-for-byte,
// and — unlike the DOM version — is testable headlessly.
export function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
