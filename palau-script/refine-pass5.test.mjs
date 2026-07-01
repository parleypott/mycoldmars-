// Palau REFINE pass 5 — guards the six critic fixes so they can't silently regress.
// Runs under bun (auto-discovered by scripts/run-tests.mjs). Sets the Palau episode BEFORE
// importing the shared engine so document-builder's module-load IS_PALAU gate is true.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { setEpisode } from '../burma-script/src/episode-config.js';
import { PALAU } from './config.js';

setEpisode(PALAU);

const { buildEditorDocument, ensureTableDoc, docToBlocks } = await import('../burma-script/src/document-builder.js');
const { sequenceTagText, sequenceTimecode } = await import('../burma-script/src/extensions/blocks.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

// ---- helpers ----
function walkSot(node, cb) {
  if (node.type === 'sotBlock') cb(node);
  (node.content || []).forEach((child) => walkSot(child, cb));
}
function textNodes(node) {
  const out = [];
  (function rec(n) {
    if (n.type === 'text') out.push(n);
    (n.content || []).forEach(rec);
  })(node);
  return out;
}
function firstBlockOfRow(row) {
  return row?.content?.[0]?.content?.[0] || null;
}
function rowVisibleText(row) {
  return (row.content || [])
    .flatMap((cell) => cell.content || [])
    .map((blk) => textNodes(blk).map((t) => t.text || '').join(''))
    .join('')
    .trim();
}

const doc = ensureTableDoc(buildEditorDocument(PALAU.blocksData));

// ============================ GAP C — sequence tag ============================
console.log('GAP C — sequence tag never renders body text / doubles the speaker');

test('sequenceTimecode returns the parsed timecode, never the rawTimecode body fallback', () => {
  assert.strictEqual(sequenceTimecode({ timecode: '00:03:29', rawTimecode: 'Expert: “quote” body' }), '00:03:29');
  // No real timecode → empty, even though rawTimecode carries a 200-char body snippet.
  assert.strictEqual(sequenceTimecode({ timecode: '', rawTimecode: 'Expert: “calcium carbonate” body' }), '');
});

test('sequenceTagText is empty when there is no real timecode (timecode-less SOT shows no tag)', () => {
  assert.strictEqual(sequenceTagText({ speaker: 'Expert', timecode: '', rawTimecode: 'Expert: “calcium carbonate”' }), '');
});

test('sequenceTagText is a single un-doubled “<name> <tc>” clause', () => {
  assert.strictEqual(
    sequenceTagText({ speaker: '20260311-James Porter - Interview:', timecode: '00:03:29' }),
    '20260311-James Porter - Interview: 00:03:29',
  );
  // Doubled + multi-line speaker collapses to one clean label + tc.
  assert.strictEqual(
    sequenceTagText({ speaker: 'PORTER\nPORTER', timecode: '18:34:56:22' }),
    'PORTER 18:34:56:22',
  );
});

test('no live-gated Palau seq-tag is doubled, multi-line, or carries a quote', () => {
  let shown = 0;
  const bad = [];
  walkSot(doc, (n) => {
    const a = n.attrs;
    const gated = !!String(a.speaker || '').trim() && !!sequenceTimecode(a);
    if (!gated) return;
    shown += 1;
    const tag = sequenceTagText(a);
    if (tag.includes('\n') || /\b(\w+)\b\s+\1\b/i.test(tag) || /"|“|”/.test(tag)) bad.push(tag);
  });
  assert.ok(shown > 30, `expected many live seq-tags, got ${shown}`);
  assert.strictEqual(bad.length, 0, `corrupted tags: ${JSON.stringify(bad.slice(0, 4))}`);
});

// ============================ GAP A + B — chapter framing ============================
console.log('GAP A/B — every chapter/scene header starts its own top-level tableRow');

test('all 9 Palau chapters are top-level rows with the chapterBlock as cell.firstChild', () => {
  let chapters = 0;
  for (const row of doc.content) {
    if (firstBlockOfRow(row)?.type === 'chapterBlock') chapters += 1;
  }
  assert.strictEqual(chapters, 9, `expected 9 framed chapters, got ${chapters}`);
});

test('ensureTableDoc is idempotent (a correct doc passes through unchanged)', () => {
  const once = ensureTableDoc(buildEditorDocument(PALAU.blocksData));
  const twice = ensureTableDoc(once);
  assert.strictEqual(JSON.stringify(twice), JSON.stringify(once));
});

test('a stale doc that stacks chapters inside one full-width cell is split into per-chapter rows', () => {
  // Simulate the stale-persisted shape: two chapter cartridges crammed into a single cell.
  const stale = {
    type: 'doc',
    content: [{
      type: 'tableRow',
      attrs: { cols: 1 },
      content: [{
        type: 'tableCell',
        attrs: { role: 'full' },
        content: [
          { type: 'chapterBlock', attrs: { blockId: 'c1', genre: 'map' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LOOK AT THIS MAP' }] }] },
          { type: 'chapterBlock', attrs: { blockId: 'c2', genre: 'ground' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'GR1' }] }] },
        ],
      }],
    }],
  };
  const fixed = ensureTableDoc(stale);
  const chapterRows = fixed.content.filter((r) => firstBlockOfRow(r)?.type === 'chapterBlock');
  assert.strictEqual(chapterRows.length, 2, 'both stacked chapters should become their own rows');
});

// ============================ GAP D — interview timecodes ============================
console.log('GAP D — bracketed interview [hh:mm:ss] codes carry NO DAY prefix');

test('interview bracket timecode chips have day=null (no “DAY n ·” prefix)', () => {
  let checked = 0;
  let leaked = 0;
  walkSot(doc, (n) => {
    if (!/Interview:/i.test(n.attrs?.speaker || '')) return;
    checked += 1;
    for (const t of textNodes(n)) {
      const tc = (t.marks || []).find((m) => m.type === 'timecode');
      if (tc && /^\d{2}:\d{2}:\d{2}$/.test(t.text) && tc.attrs?.day != null) leaked += 1;
    }
  });
  assert.ok(checked > 10, `expected many interview SOTs, got ${checked}`);
  assert.strictEqual(leaked, 0, `interview chips still leaking a DAY prefix: ${leaked}`);
});

// ============================ GAP E — leaking duration brackets ============================
console.log('GAP E — [7.3]-style duration tokens do not render in visible prose');

test('no visible [<n>.<n>] duration token survives in the built doc', () => {
  let leaked = 0;
  walkSot(doc, (n) => {
    for (const t of textNodes(n)) if (/\[\d+\.\d+\]/.test(t.text)) leaked += 1;
  });
  assert.strictEqual(leaked, 0, `visible duration tokens: ${leaked}`);
});

// ============================ GAP F — orphan empty grid rows ============================
console.log('GAP F — no empty two-column grid row floats loose');

test('no empty two-column (cols:2) row survives in the built doc', () => {
  const empties = doc.content.filter((r) => r.attrs?.cols === 2 && !rowVisibleText(r));
  assert.strictEqual(empties.length, 0, `empty grid rows: ${empties.length}`);
});

// ============================ ZERO-LOSS — audit proxy ============================
console.log('ZERO-LOSS — every source timecode still renders (static audit proxy)');

test('every timecode in palau-source.txt still appears in the rendered doc text', () => {
  const srcPath = fileURLToPath(new URL('./palau-source.txt', import.meta.url));
  const src = readFileSync(srcPath, 'utf8');
  const TC = /(?<!\d)(?<!\d:)(?:\d{2}:\d{2}:\d{2}:\d{2}|\d{2}:\d{2}:\d{2})(?!:?\d)/g;
  const srcTc = [...new Set([...src.matchAll(TC)].map((m) => m[0]))];
  // Flatten the whole built doc to text (node text + timecode-marked text nodes both count).
  let rendered = '';
  (function rec(n) {
    if (n.type === 'text') rendered += (n.text || '') + ' ';
    (n.content || []).forEach(rec);
  })(doc);
  const renderedTc = new Set([...rendered.matchAll(TC)].map((m) => m[0]));
  const missing = srcTc.filter((tc) => !renderedTc.has(tc));
  assert.ok(srcTc.length > 40, `sanity: expected many source timecodes, got ${srcTc.length}`);
  assert.strictEqual(missing.length, 0, `MISSING timecodes: ${JSON.stringify(missing.slice(0, 8))}`);
});

test('docToBlocks round-trips the built doc without throwing (persistence path intact)', () => {
  const blocks = docToBlocks(doc);
  assert.ok(Array.isArray(blocks) && blocks.length > 100, `expected a full blocks array, got ${blocks?.length}`);
});

console.log(`\nPalau refine-pass5: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
