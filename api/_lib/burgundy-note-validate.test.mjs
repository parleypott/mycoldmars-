// Locks the input-validation contract of the BERGUNDY reader-notes endpoint
// (api/burgundy-notes.js) — a PUBLIC, service-role, un-gated write+delete API.
// Imports the REAL sanitizer/guard so any loosening of a caps/allowlist/shape
// breaks this test.

import assert from 'node:assert/strict';
import { sanitizeNoteRow, isValidNoteId, NOTE_COLORS } from './burgundy-note-validate.js';

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; };
const eq = (a, b, m) => { assert.equal(a, b, m); pass++; };

// ── sanitizeNoteRow: required fields ──
eq(sanitizeNoteRow(null), null, 'null body rejected');
eq(sanitizeNoteRow({}), null, 'empty body rejected (no para_key/quote)');
eq(sanitizeNoteRow({ para_key: 'a', quote: '   ' }), null, 'whitespace-only quote rejected');
eq(sanitizeNoteRow({ para_key: 1, quote: 'hi' }), null, 'non-string para_key rejected');
eq(sanitizeNoteRow({ para_key: 'a', quote: 42 }), null, 'non-string quote rejected');

// ── happy path: all fields preserved ──
{
  const row = sanitizeNoteRow({
    para_key: '2:5', quote: 'the amber horizon', prefix: 'over ', note: 'lovely',
    color: 'green', reader: 'johnny', chapter_idx: 3, book_version: 'v-test-1',
  });
  ok(row, 'valid body accepted');
  eq(row.para_key, '2:5', 'para_key kept');
  eq(row.quote, 'the amber horizon', 'quote kept');
  eq(row.prefix, 'over ', 'prefix kept');
  eq(row.note, 'lovely', 'note kept');
  eq(row.color, 'green', 'allowlisted color kept');
  eq(row.reader, 'johnny', 'reader kept');
  eq(row.chapter_idx, 3, 'integer chapter kept');
  eq(row.book_version, 'v-test-1', 'book_version kept');
}

// ── length caps (load-bearing: a loosened cap goes RED) ──
{
  const row = sanitizeNoteRow({
    para_key: 'k'.repeat(100), quote: 'q'.repeat(5000), prefix: 'p'.repeat(200),
    note: 'n'.repeat(9000), reader: 'r'.repeat(100), book_version: 'b'.repeat(100),
  });
  eq(row.para_key.length, 40, 'para_key capped at 40');
  eq(row.quote.length, 2000, 'quote capped at 2000');
  eq(row.prefix.length, 64, 'prefix capped at 64');
  eq(row.note.length, 4000, 'note capped at 4000');
  eq(row.reader.length, 40, 'reader capped at 40');
  eq(row.book_version.length, 40, 'book_version capped at 40');
}

// ── color allowlist ──
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', color: 'purple' }).color, 'amber', 'unknown color -> amber');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x' }).color, 'amber', 'missing color -> amber');
for (const c of NOTE_COLORS)
  eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', color: c }).color, c, `${c} allowed`);

// ── chapter_idx: integer + clamp (the int-column fix) ──
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_idx: 3.7 }).chapter_idx, 3, 'fractional floored to int (matches int column)');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_idx: -5 }).chapter_idx, 0, 'negative clamped to 0');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_idx: 5000 }).chapter_idx, 999, 'over-large clamped to 999');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_idx: 'nope' }).chapter_idx, 0, 'non-numeric -> 0');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x' }).chapter_idx, 0, 'missing chapter_idx -> 0');

// ── name: reader signature, capped, defaults empty ──
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x' }).name, '', 'missing name -> empty string');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', name: 'Ollie' }).name, 'Ollie', 'name passes through');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', name: 'z'.repeat(200) }).name.length, 60, 'name capped at 60');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', name: 42 }).name, '42', 'non-string name coerced');

// ── chapter_id: the authoring tool's PERMANENT chapter anchor (rides book.json
//    since 2026-07-16, app commit bd9c9cd) — capped, coerced, defaults empty.
//    Locks the new column's sanitizer contract; migration 034 adds the column.
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x' }).chapter_id, '', 'missing chapter_id -> empty string');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_id: 'ch-7Ka9' }).chapter_id, 'ch-7Ka9', 'chapter_id passes through');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_id: 'z'.repeat(200) }).chapter_id.length, 40, 'chapter_id capped at 40');
eq(sanitizeNoteRow({ para_key: 'a', quote: 'x', chapter_id: 12345 }).chapter_id, '12345', 'non-string chapter_id coerced');

// ── isValidNoteId: canonical UUID shape only ──
ok(isValidNoteId('0f9c1e2a-1b2c-4d5e-8f90-a1b2c3d4e5f6'), 'canonical uuid accepted');
ok(isValidNoteId('0F9C1E2A-1B2C-4D5E-8F90-A1B2C3D4E5F6'), 'uppercase uuid accepted');
eq(isValidNoteId('-'.repeat(36)), false, 'MUTATION PROOF: 36 bare hyphens rejected (old /^[0-9a-f-]{36}$/ accepted it)');
eq(isValidNoteId('0f9c1e2a1b2c4d5e8f90a1b2c3d4e5f6'), false, '32 hex, no hyphens, rejected');
eq(isValidNoteId('0f9c1e2a-1b2c-4d5e-8f90-a1b2c3d4e5f6x'), false, 'trailing char rejected');
eq(isValidNoteId(''), false, 'empty rejected');
eq(isValidNoteId(null), false, 'null rejected');
eq(isValidNoteId('0f9c1e2a-1b2c-4d5e-8f90-a1b2c3d4e5g6'), false, 'non-hex g rejected');

// Prove the OLD loose guard would have admitted the hyphen soup — the fix genuinely tightened it.
const OLD = /^[0-9a-f-]{36}$/i;
ok(OLD.test('-'.repeat(36)) && !isValidNoteId('-'.repeat(36)), 'fix rejects what the old regex admitted');

console.log(`burgundy-note-validate.test.mjs: ${pass} assertions passed`);
