// Verifier lock for burma-essays fmtDate() — guards the highlights-panel date
// render against a present-but-unparseable / nullish created_at (the
// present-but-bad-date class: toLocaleDateString returns the literal
// "Invalid Date" string and NEVER throws, so the old try/catch was useless).
// EXTRACTS the real shipped fmtDate from index.html at runtime (can't drift).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');

// Pull the exact shipped one-liner: `function fmtDate(iso) { ... }`
const m = html.match(/function fmtDate\(iso\)[^\n]*\}/);
assert(m, 'could not locate fmtDate in index.html');
const src = m[0];
const fmtDate = new Function(`${src} return fmtDate;`)();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error('✗', name, '\n   ', e.message); } };

// --- RED proof: reconstruct the OLD useless-try/catch and show it leaks "Invalid Date" ---
function oldFmtDate(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}
t('RED proof: old fmtDate leaks "Invalid Date" on a corrupt iso', () => {
  assert.strictEqual(oldFmtDate('garbage'), 'Invalid Date', 'old must leak Invalid Date');
  assert.strictEqual(fmtDate('garbage'), '', 'shipped fmtDate must return "" on a corrupt iso');
});
t('RED proof: old fmtDate leaks "Invalid Date" on undefined; shipped returns ""', () => {
  assert.strictEqual(oldFmtDate(undefined), 'Invalid Date');
  assert.strictEqual(fmtDate(undefined), '');
});
t('RED proof: old fmtDate renders misleading epoch "Jan 1" on null; shipped returns ""', () => {
  assert.strictEqual(oldFmtDate(null), 'Jan 1', 'old new Date(null) is the 1970 epoch');
  assert.strictEqual(fmtDate(null), '');
});

// --- FIX: every corrupt / nullish input degrades to "" (never "Invalid Date", never "NaN") ---
for (const bad of ['garbage', 'not-a-date', '', null, undefined, 'xx-xx-xxxx', '???']) {
  t(`corrupt/nullish ${JSON.stringify(bad)} -> ""`, () => {
    const out = fmtDate(bad);
    assert.strictEqual(out, '', `expected "", got ${JSON.stringify(out)}`);
  });
}
t('output never contains "Invalid Date" across hostile inputs', () => {
  for (const v of ['garbage', '', null, undefined, 'nope', '2026-13-99zzz', {}, []]) {
    const out = fmtDate(v);
    assert(!String(out).includes('Invalid Date'), `leaked Invalid Date on ${JSON.stringify(v)}`);
    assert(!String(out).includes('NaN'), `leaked NaN on ${JSON.stringify(v)}`);
  }
});

// --- NO REGRESSION: every VALID date is byte-identical to the old formatter ---
const validIsos = [
  '2026-06-24T10:00:00Z', '2026-01-01T00:00:00Z', '2025-12-31T23:59:59Z',
  '2026-03-15', '2026-07-04T12:30:00Z', '2024-02-29T08:00:00Z',
];
for (const iso of validIsos) {
  t(`valid ${iso} === old formatter (no regression)`, () => {
    assert.strictEqual(fmtDate(iso), oldFmtDate(iso), 'valid dates must be byte-identical to the old render');
  });
}
t('valid iso renders a real month/day (e.g. Jun 24)', () => {
  assert.strictEqual(fmtDate('2026-06-24T10:00:00Z'), 'Jun 24');
});

console.log(`fmt-date: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
