/**
 * Tests for document-builder — the WP-01 Burma Script editor's blocks <-> ProseMirror
 * round-trip. Run: node src/document-builder.test.mjs
 *
 * Headline bug (fixed in nodeText): inlineContent splits an inline span that contains an
 * embedded broadcast timecode into multiple text nodes (the timecode fragment carries an
 * extra 'timecode' chip mark) — but every fragment still carries the span mark. nodeText
 * re-wrapped EACH fragment independently, so the round-trip exploded one span into several
 * tokens:
 *   "[B roll of hotels on DAY 2 00:09:19:03]"  ->  "[B roll of hotels on DAY 2][00:09:19:03]"
 *   "{tk the exact time was 02:02:01:07 here}" ->  "{tk the exact time was}{tk 02:02:01:07}{tk here}"
 * Since real Burma scripts are full of bracketed visual cues that carry a timecode, this
 * corrupted the persisted blocks on the FIRST save. The data-integrity law of this module is
 * "keep every word AND every structure" — so this is a real round-trip corruption, not cosmetics.
 *
 * The fix coalesces consecutive same-span text fragments into ONE token before wrapping.
 * The surrounding cases lock in the already-correct round-trip so the fix can't regress.
 */
import { buildEditorDocument, docToBlocks, nodeText } from './document-builder.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`FAIL ${label}:\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label}`); }
};

// Round-trip a single block and return the re-derived block of the same kind.
const roundtrip = (block) => {
  const out = docToBlocks(buildEditorDocument([block]));
  return out.find((b) => b.text !== undefined || b.title !== undefined) || out[0];
};
const textOf = (block) => { const b = roundtrip(block); return b.text ?? b.title ?? ''; };

// ── THE BUG: span containing an embedded timecode must round-trip as ONE token ──

eq(
  textOf({ id: 'b1', type: 'broll', timecode: { tc: '02:00:00:00', day: 2 },
    text: '[B roll of hotels on DAY 2 00:09:19:03]' }),
  '[B roll of hotels on DAY 2 00:09:19:03]',
  'visual span with embedded timecode stays one [..] token (was split into two)'
);

eq(
  textOf({ id: 'v1', type: 'vo', voStatus: 'todo',
    text: 'we filmed {tk the exact time was 02:02:01:07 here} and moved on' }),
  'we filmed {tk the exact time was 02:02:01:07 here} and moved on',
  'tk span with embedded timecode stays one {tk ..} token (was exploded into three)'
);

eq(
  textOf({ id: 'f1', type: 'vo', voStatus: 'todo',
    text: 'check {fc the strike began at 00:01:02:03 sharp} please' }),
  'check {fc the strike began at 00:01:02:03 sharp} please',
  'factcheck span with embedded timecode stays one {fc ..} token'
);

eq(
  textOf({ id: 'b2', type: 'broll', timecode: { tc: '01:00:00:00', day: 1 },
    text: '[range 03:15:11:03 to 03:15:38:05 wide]' }),
  '[range 03:15:11:03 to 03:15:38:05 wide]',
  'visual span with TWO embedded timecodes stays one [..] token'
);

// ── No-regression: round-trips that were already correct must stay correct ──

eq(
  textOf({ id: 'v2', type: 'vo', voStatus: 'todo',
    text: 'plain narration with [a visual] and {tk a writing ask} but no timecodes' }),
  'plain narration with [a visual] and {tk a writing ask} but no timecodes',
  'spans without timecodes round-trip unchanged'
);

eq(
  textOf({ id: 'v3', type: 'vo', voStatus: 'todo',
    text: 'we shot it at 04:36:46:01 in the field' }),
  'we shot it at 04:36:46:01 in the field',
  'bare prose timecode (no span) round-trips as plain text, not wrapped'
);

eq(
  textOf({ id: 'v4', type: 'vo', voStatus: 'todo',
    text: 'no spans at all here, just prose' }),
  'no spans at all here, just prose',
  'prose with no spans and no timecodes round-trips unchanged'
);

// A keyword-less {tk}/{fc}/[..] still re-serializes with its keyword preserved.
eq(
  textOf({ id: 'v5', type: 'vo', voStatus: 'todo',
    text: 'lead {tk fractured-shape} and [highlights India] end' }),
  'lead {tk fractured-shape} and [highlights India] end',
  'keyworded tk span + bracket span without timecodes preserved'
);

// nodeText unit: two distinct adjacent same-type spans collapse (pre-existing ProseMirror
// behaviour — identical-mark adjacent text merges) — documents that we did NOT regress it.
eq(
  nodeText({ type: 'paragraph', content: [
    { type: 'text', text: 'before ' },
    { type: 'text', text: 'first', marks: [{ type: 'tkSpan' }] },
    { type: 'text', text: '00:00:01:00', marks: [{ type: 'tkSpan' }, { type: 'timecode', attrs: { tc: '00:00:01:00' } }] },
    { type: 'text', text: ' after' },
  ] }),
  'before {tk first00:00:01:00} after',
  'nodeText reunites a tk span split by a timecode chip into one token'
);

// ── docToBlocks structural sanity ──
{
  const doc = buildEditorDocument([
    { id: 'c1', type: 'chapter', genre: 'history', title: 'HISTORY 1', rawSource: 'CH: HISTORY 1' },
    { id: 's1', type: 'sot', timecode: { tc: '02:02:01:07', day: 1 }, text: 'JACK: 02:02:01:07 we begin' },
  ]);
  const blocks = docToBlocks(doc);
  ok(blocks.some((b) => b.type === 'chapter'), 'chapter block survives round-trip');
  ok(blocks.some((b) => b.type === 'sot' && /02:02:01:07/.test(b.text)), 'sot timecode text survives round-trip');
}

console.log(`\ndocument-builder: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
