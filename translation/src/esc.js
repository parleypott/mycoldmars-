// Attribute-safe HTML escape for the Interpreter client's inline template strings.
//
// This REPLACES a former local main.js esc() that built its output via a DOM
// textContent -> innerHTML round-trip. That approach escapes only & < > (and
//  ) — it does NOT escape " or ' — because the HTML serialization spec only
// quote-escapes inside *attribute value* serialization, never text nodes. But
// main.js feeds esc() into ~40 double-quoted attribute contexts (title="…",
// style="background:…", value="…", data-*="…"), so a value carrying a double
// quote — a filename like `Interview "final".mp4` (legal on macOS/Linux and
// common), or a synced editor display-name/color in the multi-user library —
// broke out of the attribute, mangling the DOM (and, with a crafted value,
// injecting attributes). The find-attr-unsafe-escaper gate never caught it
// because it scans for .replace char-map escapers, not DOM-based ones.
//
// Fix: delegate to the shared 5-char escapeHtml (& < > " '), which is safe in
// BOTH text and attribute context. The `str ? … : ''` short-circuit preserves
// the old esc()'s exact falsy behavior (0/false/''/null/undefined -> ''), so the
// output is byte-identical for every falsy input and every quote-free string;
// the only change is that quote-bearing values are now escaped instead of
// leaking raw.
import { escapeHtml } from './html-escape.js';

export function esc(str) {
  return str ? escapeHtml(str) : '';
}
