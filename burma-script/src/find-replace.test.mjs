/*
 * find-replace.test.mjs — Enterprise Wave 1, feature #1.
 *
 * Locks the two load-bearing behaviors of the Find & Replace extension:
 *   1. computeMatches counts and positions matches correctly — case-insensitive by default,
 *      case-sensitive on request, non-overlapping, across inline marks WITHIN a block, and never
 *      spanning block boundaries.
 *   2. replaceAll (via the exported replaceAllTr, the exact production code the command dispatches)
 *      rewrites every match in ONE transaction, through the normal transaction path, and the plugin
 *      recomputes the match set afterward.
 *
 * Uses a REAL ProseMirror schema + EditorState with the real plugin mounted (mirrors
 * ch02-stale-range.test.mjs), so this is not a mock — it exercises the shipped code.
 */
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import { BURMA_NODES } from './extensions/blocks.js';
import { BURMA_TABLE_NODES } from './extensions/table.js';
import { BURMA_MARKS } from './extensions/marks.js';
import {
  computeMatches, clampCurrent, findReplaceKey, buildFindReplacePlugin,
  replaceAllTr, replaceCurrentTr,
} from './extensions/find-replace.js';

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log('FAIL ' + label); } };
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);

const schema = getSchema([
  StarterKit.configure({
    heading: false, blockquote: false, codeBlock: false, code: false,
    horizontalRule: false, dropcursor: false, gapcursor: false,
  }),
  Dropcursor.configure({ color: '#d23b2c', width: 2 }),
  Gapcursor,
  ...BURMA_TABLE_NODES,
  ...BURMA_NODES,
  ...BURMA_MARKS,
]);

const boldType = schema.marks.bold;

// Build a doc with two full-width rows, each a voBlock holding one paragraph.
function docFromParagraphs(paraSpecs) {
  const rows = paraSpecs.map((inline, i) => {
    const para = schema.nodes.paragraph.create(null, inline);
    const block = schema.nodes.voBlock.create({ blockId: 'b' + i }, para);
    const cell = schema.nodes.tableCell.create({ role: 'full' }, block);
    return schema.nodes.tableRow.create({ cols: 1 }, cell);
  });
  return schema.topNodeType.create(null, rows);
}

function stateWith(doc) {
  return EditorState.create({ schema, doc, plugins: [buildFindReplacePlugin()] });
}
function setQuery(state, query, caseSensitive = false) {
  const tr = state.tr.setMeta(findReplaceKey, { query, caseSensitive, current: 0 });
  return state.apply(tr);
}
function pluginMatches(state) { return findReplaceKey.getState(state).matches; }

// ── 1. clampCurrent ─────────────────────────────────────────────────────────────────────────────
eq(clampCurrent(0, 0), 0, 'clampCurrent: empty list → 0');
eq(clampCurrent(5, 3), 2, 'clampCurrent: wraps forward');
eq(clampCurrent(-1, 3), 2, 'clampCurrent: wraps backward');

// ── 2. computeMatches counting ────────────────────────────────────────────────────────────────
{
  const doc = docFromParagraphs([
    [schema.text('the river runs and the road ends')],
    [schema.text('THE last line')],
  ]);
  // "the" appears: line1 "the"(x2, incl. "The" none here) + line2 "THE" → 3 case-insensitive.
  const ci = computeMatches(doc, 'the', false);
  eq(ci.length, 3, 'computeMatches: case-insensitive counts all 3 "the"');
  const cs = computeMatches(doc, 'the', true);
  eq(cs.length, 2, 'computeMatches: case-sensitive counts only lowercase "the"');
  // Positions are ascending and non-overlapping.
  ok(ci.every((m, i) => i === 0 || m.from >= ci[i - 1].to), 'computeMatches: non-overlapping, ascending');
  // Each reported range actually reads back as the needle (case-insensitively).
  ok(ci.every((m) => doc.textBetween(m.from, m.to, '').toLowerCase() === 'the'), 'computeMatches: ranges cover exactly the needle');
}

// ── 3. match survives an inline mark splitting the word (bold in the middle) ──────────────────────
{
  // "riv" + bold "e" + "r" → textContent is "river"; a search for "river" must still hit once.
  const doc = docFromParagraphs([[
    schema.text('riv'), schema.text('e', [boldType.create()]), schema.text('r flows'),
  ]]);
  eq(computeMatches(doc, 'river', false).length, 1, 'computeMatches: matches across an inline mark boundary within a block');
}

// ── 4. does NOT span block boundaries ─────────────────────────────────────────────────────────────
{
  // "end" ends block 1, "less" starts block 2 — "endless" must NOT match across the boundary.
  const doc = docFromParagraphs([[schema.text('the end')], [schema.text('less time')]]);
  eq(computeMatches(doc, 'endless', false).length, 0, 'computeMatches: no cross-block match');
}

// ── 4b. offset stays correct after a length-CHANGING lowercase char (İ → i̇) ──────────────────────
{
  // 'İ' (U+0130) lowercases to TWO code units ('i' + combining dot). The old path lowercased the whole
  // text and ran indexOf on that, so every offset after 'İ' drifted +1 and the range ran off the block.
  // The regex path matches in ORIGINAL coordinates, so the range covers exactly "cat".
  const doc = docFromParagraphs([[schema.text('İx cat')]]);
  const ms = computeMatches(doc, 'cat', false);
  eq(ms.length, 1, 'computeMatches: one "cat" after a length-changing İ');
  eq(doc.textBetween(ms[0].from, ms[0].to, ''), 'cat', 'computeMatches: range covers exactly "cat" (no İ offset drift)');
  // And it must stay inside the block (old code produced to = block-end+1).
  ok(ms[0].to <= doc.content.size, 'computeMatches: range does not overrun the doc');
  // Case-INSENSITIVE match of the İ itself reports its ORIGINAL 1-char width, not the 2-char lowercase.
  const upper = computeMatches(doc, 'İ', false);
  ok(upper.length === 1 && (upper[0].to - upper[0].from) === 1, 'computeMatches: İ match keeps original 1-char width');
}

// ── 4c. query is matched LITERALLY — regex metacharacters are escaped, not interpreted ─────────────
{
  // "a.b" must match the literal "a.b", NOT "aXb" (which a raw regex `a.b` would). Proves the new
  // regex path escapes metacharacters and preserves the old indexOf literal semantics.
  const doc = docFromParagraphs([[schema.text('a.b axb a.b')]]);
  eq(computeMatches(doc, 'a.b', false).length, 2, 'computeMatches: "a.b" matches literal dots only (metachar escaped)');
  eq(computeMatches(doc, 'a.b', true).length, 2, 'computeMatches: case-sensitive "a.b" also literal');
  // A pure-metachar query is inert as a literal (no accidental catastrophic pattern).
  const doc2 = docFromParagraphs([[schema.text('cost is $5 (five)')]]);
  eq(computeMatches(doc2, '$5', false).length, 1, 'computeMatches: "$5" matched literally');
  eq(computeMatches(doc2, '(five)', false).length, 1, 'computeMatches: "(five)" matched literally, not as a group');
}

// ── 5. plugin apply wires computeMatches + clamps current ─────────────────────────────────────────
{
  let state = stateWith(docFromParagraphs([[schema.text('go go go')]]));
  state = setQuery(state, 'go');
  eq(pluginMatches(state).length, 3, 'plugin: activating a query populates matches');
  // Empty query clears matches.
  state = setQuery(state, '');
  eq(pluginMatches(state).length, 0, 'plugin: clearing the query drops matches');
}

// ── 6. replaceAll rewrites every match in ONE transaction (production replaceAllTr) ───────────────
{
  let state = stateWith(docFromParagraphs([[schema.text('cat cat cat')], [schema.text('a cat here')]]));
  state = setQuery(state, 'cat');
  eq(pluginMatches(state).length, 4, 'replaceAll: 4 matches before');
  const tr = replaceAllTr(state, 'dog');
  ok(!!tr, 'replaceAll: builds a transaction');
  // ONE undo step: the transaction is a single dispatch (multiple steps, one history group).
  state = state.apply(tr);
  const text = state.doc.textBetween(0, state.doc.content.size, ' ');
  ok(!/cat/.test(text) && /dog/.test(text), 'replaceAll: every "cat" became "dog"');
  eq(pluginMatches(state).length, 0, 'replaceAll: no "cat" matches remain (plugin recomputed)');
  // And the new word is now findable.
  state = setQuery(state, 'dog');
  eq(pluginMatches(state).length, 4, 'replaceAll: 4 "dog" now present');
}

// ── 7. replaceCurrent replaces only the current match ─────────────────────────────────────────────
{
  let state = stateWith(docFromParagraphs([[schema.text('one two two')]]));
  state = setQuery(state, 'two'); // current = 0 (first "two")
  const before = pluginMatches(state).length;
  eq(before, 2, 'replaceCurrent: 2 matches before');
  const tr = replaceCurrentTr(state, 'X');
  state = state.apply(tr);
  eq(pluginMatches(state).length, 1, 'replaceCurrent: one match replaced, one remains');
  ok(/two/.test(state.doc.textBetween(0, state.doc.content.size, ' ')), 'replaceCurrent: the other "two" survives');
}

console.log(`find-replace: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
