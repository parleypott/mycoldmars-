// Verifier-layer LOCK for the interpreter editor's two custom ProseMirror
// marks: HighlightMark (the soundbite-tag highlight Johnny applies, whose attrs
// flow to SOT Hunter + exports) and DeletedMark (the soft-delete collapse
// mark). Both were ZERO-coverage.
//
// renderHTML() is LIVE-exercised on every highlight/deleted render — it
// produces the exact <mark>/<span> styling Johnny sees in his editor, so a
// regression (wrong color interpolation, dropped data-attr, wrong class,
// changed default color) silently breaks the rendering with no signal. This
// locks that output contract.
//
// It ALSO pins a real, LATENT divergence (the burma-script blocks.js class):
// addAttributes() declares 6 identity attrs (tagId/tagName/color/
// segmentNumbers/originalText/note) but parseHTML() returns a tag rule with NO
// getAttrs — so on an HTML round-trip (serialize -> reparse) every attr resets
// to its default; the highlight's tag/color/segment refs are dropped.
// Confirmed latent: the live persistence path is editor.getJSON() (PM JSON
// preserves all mark attrs natively — parseHTML never runs), and the editor's
// own copy handler forces text/plain (Editor.jsx) so an internal copy carries
// no <mark> markup to reparse. parseHTML only runs on an external HTML paste
// containing <mark data-highlight>, which no real source emits. Whether a
// pasted highlight SHOULD keep its tag (and how to avoid duplicate tag ids /
// stale segmentNumbers) is a product/taste call — left for Johnny, NOT changed
// unattended. This test PINS the gap so a future round-trip "fix" is a
// deliberate, caught change.
//
// Test-only, zero source change. Imports the REAL shipped marks and exercises
// their config methods (addAttributes/renderHTML/parseHTML are pure — they do
// not touch `this`).
//
// Run: bun translation/src/editor/extensions/marks.test.mjs  (auto-discovered by `bun run test`)
import { HighlightMark } from './HighlightMark.js';
import { DeletedMark } from './DeletedMark.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${g}\n   want: ${w}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

const H = HighlightMark.config;
const D = DeletedMark.config;
const hAttrs = () => H.addAttributes.call({});
const hRender = (a) => H.renderHTML.call({}, { HTMLAttributes: a });
const hParse = () => H.parseHTML.call({});
const dAttrs = () => D.addAttributes.call({});
const dRender = (a) => D.renderHTML.call({}, { HTMLAttributes: a });
const dParse = () => D.parseHTML.call({});

// A realistic highlight mark's attributes.
const TAGGED = {
  tagId: 'tag_abc',
  tagName: 'pull-quote',
  color: '#1A9E4B',
  segmentNumbers: [3, 4, 5],
  originalText: 'the exact words',
  note: 'use this for the cold open',
};

// ── inline RED proof: the renderHTML output contract is non-trivial ──
// A naive renderer that dropped the tag color (hardcoded black) would NOT
// match the shipped style — so these asserts have teeth.
{
  const shipped = hRender(TAGGED)[1].style;
  ok(shipped.includes('#1A9E4B'), 'RED proof: shipped style embeds the tag color');
  const naive = 'background-color: #00000022; border-bottom: 2px solid #000000;';
  ok(shipped !== naive, 'RED proof: shipped style is not the color-dropped naive form');
}

// ── HighlightMark: declared attributes + defaults ──
eq(H.name, 'highlight', 'HighlightMark name');
eq(
  Object.keys(hAttrs()).sort(),
  ['color', 'note', 'originalText', 'segmentNumbers', 'tagId', 'tagName'],
  'HighlightMark declares exactly the 6 identity attrs',
);
{
  const a = hAttrs();
  eq(a.tagId.default, null, 'tagId default null');
  eq(a.tagName.default, '', 'tagName default empty');
  eq(a.color.default, '#DD2C1E', 'color default #DD2C1E');
  eq(a.segmentNumbers.default, [], 'segmentNumbers default []');
  eq(a.originalText.default, '', 'originalText default empty');
  eq(a.note.default, '', 'note default empty');
}

// ── HighlightMark: renderHTML output (the LIVE-exercised contract) ──
{
  const out = hRender(TAGGED);
  eq(out[0], 'mark', 'renderHTML emits a <mark>');
  eq(out[2], 0, 'renderHTML has a content hole (0)');
  const attrs = out[1];
  eq(attrs['data-highlight'], '', 'data-highlight marker present');
  eq(attrs['data-tag-id'], 'tag_abc', 'data-tag-id = tagId');
  eq(attrs['data-tag-name'], 'pull-quote', 'data-tag-name = tagName');
  eq(attrs.class, 'editor-highlight', 'class = editor-highlight');
  eq(
    attrs.style,
    'background-color: #1A9E4B22; border-bottom: 2px solid #1A9E4B;',
    'style embeds the tag color (fill 22 + 2px border)',
  );
  eq(attrs.title, 'pull-quote', 'title = tagName when present');
}
eq(hRender({ ...TAGGED, tagName: '' })[1].title, 'Highlight', 'title falls back to "Highlight" when tagName empty');
eq(
  hRender({ tagId: null, tagName: '', color: '#DD2C1E', segmentNumbers: [], originalText: '', note: '' })[1].style,
  'background-color: #DD2C1E22; border-bottom: 2px solid #DD2C1E;',
  'style uses the DEFAULT color when a highlight is set with no color',
);

// ── HighlightMark: parseHTML (the LATENT divergence, pinned) ──
{
  const rules = hParse();
  ok(Array.isArray(rules), 'parseHTML returns an array of rules');
  eq(rules[0].tag, 'mark[data-highlight]', 'parseHTML matches mark[data-highlight]');
  // The crux of the divergence: 6 attrs are declared + rendered, but the parse
  // rule reads none back (no getAttrs). If a future change adds round-trip
  // support, this goes RED on purpose — forcing a deliberate review of the
  // duplicate-tagId / stale-segmentNumbers product question.
  eq(typeof rules[0].getAttrs, 'undefined', 'parseHTML has NO getAttrs — round-trip drops all attrs (latent gap, pinned)');
}

// ── DeletedMark: declared attributes + defaults ──
eq(D.name, 'deleted', 'DeletedMark name');
{
  const a = dAttrs();
  eq(Object.keys(a), ['expanded'], 'DeletedMark declares only `expanded`');
  eq(a.expanded.default, false, 'expanded default false (collapsed)');
}

// ── DeletedMark: renderHTML output (LIVE-exercised) ──
{
  const out = dRender({ expanded: false });
  eq(out[0], 'span', 'DeletedMark renderHTML emits a <span>');
  eq(out[2], 0, 'DeletedMark renderHTML has a content hole (0)');
  const attrs = out[1];
  eq(attrs['data-deleted'], '', 'data-deleted marker present');
  eq(attrs.class, 'editor-deleted', 'class = editor-deleted');
}
{
  const rules = dParse();
  eq(rules[0].tag, 'span[data-deleted]', 'DeletedMark parseHTML matches span[data-deleted]');
  // `expanded` round-trips to its default (false = collapsed), which is the
  // desired reset state anyway — so DeletedMark's gap is harmless, unlike
  // HighlightMark's. Pinned for symmetry.
  eq(typeof rules[0].getAttrs, 'undefined', 'DeletedMark parseHTML has NO getAttrs (harmless — default is the desired reset)');
}

console.log(`\nmarks.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
