// Pure cores for queen-scarlet-school block summaries (api/qss-block-summaries.js).
//
// The QSS write panel shows a numbered "story spine" — one short "what happens"
// label per block. These two functions are the Henry-facing normalization:
//   selectSummarizableBlocks — pick + cap + slice the blocks worth summarizing,
//     and produce the EXACT id list the model is asked to label.
//   zipSummaries — map the model's {id, summary}[] reply back onto the blocks
//     IN INPUT-BLOCK ORDER, keyed by id.
//
// The input-order id-zip is the load-bearing correctness property: the client
// zips block ↔ summary by position, so if a regression returned the model's
// order (or attached by the wrong key) every spine brick would show the WRONG
// block's "what happens" label, silently. Extracted verbatim from the handler
// so it can be unit-tested + mutation-locked.

export const MAX_BLOCKS = 60;
export const MAX_ID_LEN = 80;
export const MAX_TEXT_LEN = 1200;
export const MAX_SUMMARY_LEN = 120;

// Filter to blocks with a usable id + non-empty text, cap at MAX_BLOCKS, and
// slice id/text to their prompt-size limits. Returns the id-stable list the
// model is shown and that zipSummaries zips against.
export function selectSummarizableBlocks(rawBlocks) {
  const arr = Array.isArray(rawBlocks) ? rawBlocks : [];
  return arr
    .filter(b => b && typeof b === 'object' && b.id && (b.text || '').trim())
    .slice(0, MAX_BLOCKS)
    .map(b => ({ id: String(b.id).slice(0, MAX_ID_LEN), text: String(b.text).slice(0, MAX_TEXT_LEN) }));
}

// Map the model's summaries back onto `blocks` IN INPUT ORDER, keyed by id.
// Malformed items are dropped; a block with no matching summary gets ''.
// Over-long summaries are clamped to 117 chars + ellipsis.
export function zipSummaries(blocks, parsed) {
  const out = new Map();
  const list = Array.isArray(parsed?.summaries) ? parsed.summaries : [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').slice(0, MAX_ID_LEN);
    if (!id) continue;
    let summary = String(item.summary || '').trim();
    if (summary.length > MAX_SUMMARY_LEN) summary = summary.slice(0, 117).trim() + '…';
    out.set(id, summary);
  }
  return (Array.isArray(blocks) ? blocks : []).map(b => ({ id: b.id, summary: out.get(b.id) || '' }));
}
