// Locks cutter/index.html formatBytes: the sub-kilobyte fix + the no-regression
// guarantee that every value >= 1024 is byte-identical to the old function.
// Extracts the REAL shipped function from index.html at runtime (no mirror, can't drift).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// Extract `function formatBytes(bytes) { ... }` by brace-matching from index.html.
function extractFormatBytes(src) {
  const start = src.indexOf('function formatBytes(bytes)');
  assert(start !== -1, 'formatBytes not found in index.html');
  const bodyOpen = src.indexOf('{', start);
  let depth = 0, i = bodyOpen;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  const fnSrc = src.slice(start, i);
  return new Function(fnSrc + '\nreturn formatBytes;')();
}

const formatBytes = extractFormatBytes(html);

// The OLD shipped function, before the fix — for the inline RED proof + no-regression sweep.
function oldFormatBytes(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.error('FAIL:', name, '—', e.message); } }

// ── Inline RED proof: the OLD function mis-formats sub-1KB sizes ──────────────
t('RED proof: old function returns fractional KB for sub-1KB sizes', () => {
  assert.strictEqual(oldFormatBytes(512), '0.5 KB');
  assert.strictEqual(oldFormatBytes(100), '0.1 KB');
  assert.strictEqual(oldFormatBytes(0), '0.0 KB');
  // shipped (fixed) function must NOT do this
  assert.notStrictEqual(formatBytes(512), '0.5 KB');
});

// ── The fix: sub-1KB shows whole bytes with a B unit ─────────────────────────
t('512 bytes -> "512 B"', () => assert.strictEqual(formatBytes(512), '512 B'));
t('100 bytes -> "100 B"', () => assert.strictEqual(formatBytes(100), '100 B'));
t('0 bytes -> "0 B"', () => assert.strictEqual(formatBytes(0), '0 B'));
t('1 byte -> "1 B"', () => assert.strictEqual(formatBytes(1), '1 B'));
t('1023 bytes (just under 1KB) -> "1023 B"', () => assert.strictEqual(formatBytes(1023), '1023 B'));
t('no decimal point in the B tier', () => assert.ok(!formatBytes(512).includes('.')));

// ── Boundary: exactly 1024 crosses into the KB tier (unchanged) ──────────────
t('1024 bytes -> "1.0 KB" (KB tier begins at the boundary)', () =>
  assert.strictEqual(formatBytes(1024), '1.0 KB'));

// ── No-regression: every value >= 1024 is byte-identical to the OLD function ──
t('no-regression sweep: formatBytes === oldFormatBytes for all bytes >= 1024', () => {
  const sizes = [
    1024, 1536, 2048, 10240, 500 * 1024, 1024 * 1024 - 1,        // KB tier
    1024 * 1024, 5 * 1024 * 1024, 700 * 1024 * 1024, 1024 ** 3 - 1, // MB tier
    1024 ** 3, 2 * 1024 ** 3, 50 * 1024 ** 3,                     // GB tier
  ];
  for (const s of sizes) {
    assert.strictEqual(formatBytes(s), oldFormatBytes(s), `mismatch at ${s} bytes`);
  }
});

t('KB tier sample -> "1.5 KB"', () => assert.strictEqual(formatBytes(1536), '1.5 KB'));
t('MB tier sample -> "5.0 MB"', () => assert.strictEqual(formatBytes(5 * 1024 * 1024), '5.0 MB'));
t('GB tier sample -> "2.00 GB"', () => assert.strictEqual(formatBytes(2 * 1024 ** 3), '2.00 GB'));

console.log(`\nformat-bytes: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 1 - 1 : 1);
