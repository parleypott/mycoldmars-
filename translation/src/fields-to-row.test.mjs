// Lock fieldsToRow — the camelCase→snake_case transcript field mapper that
// EVERY transcript create/update (db.js saveTranscript + updateTranscript)
// flows through before hitting Supabase.
//
// Three load-bearing contracts, each proven RED against a reconstructed buggy
// variant:
//   1. PARTIAL-UPDATE GUARD — a field that is `undefined` must be ABSENT from
//      the row, not written as undefined/null. This is what lets
//      `updateTranscript(id, { name })` change only `name` and leave segments,
//      analysis, translations, editor_state, word_timings, etc. untouched.
//      Drop the `!== undefined` guard and a partial save nukes every other
//      column — silent, total data loss.
//   2. NAME MAPPING — each camelCase field must land on its exact snake_case
//      column (srtContent→srt_content, projectId→project_id, wordTimings→
//      word_timings, ...). A wrong key silently drops the data on write.
//   3. SLUG SCHEMA GATE — slug is written only when hasSlug is true, and an
//      empty-string slug coerces to null (`fields.slug || null`) so we never
//      persist "".
//
// Run: bun translation/src/fields-to-row.test.mjs  (auto-discovered by `bun run test`)
import { fieldsToRow } from './fields-to-row.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

// Every (appField, dbColumn) pair the mapper is responsible for.
const MAP = [
  ['name', 'name'],
  ['step', 'step'],
  ['segments', 'segments'],
  ['analysis', 'analysis'],
  ['translations', 'translations'],
  ['srtContent', 'srt_content'],
  ['speakerColors', 'speaker_colors'],
  ['annotations', 'annotations'],
  ['metadata', 'metadata'],
  ['projectId', 'project_id'],
  ['speakerMap', 'speaker_map'],
  ['hiddenSpeakers', 'hidden_speakers'],
  ['editorState', 'editor_state'],
  ['customSequenceName', 'custom_sequence_name'],
  ['hideUnintelligible', 'hide_unintelligible'],
  ['wordTimings', 'word_timings'],
  ['mediaUploadId', 'media_upload_id'],
  ['source', 'source'],
  ['targetLanguage', 'target_language'],
  ['translationEnabled', 'translation_enabled'],
  ['createdBy', 'created_by'],
  ['lastEditedBy', 'last_edited_by'],
];

// ── Contract 2: every field maps to its exact snake_case column ──
for (const [app, col] of MAP) {
  const sentinel = `<<${app}>>`;
  const row = fieldsToRow({ [app]: sentinel }, true);
  eq(row[col], sentinel, `${app} → ${col}`);
  eq(Object.keys(row).length, 1, `${app} produces exactly one column`);
}

// ── Contract 1: undefined fields are OMITTED, not written ──
// A realistic partial update: only `name` provided, everything else absent.
const partial = fieldsToRow({ name: 'Renamed' }, true);
eq(Object.keys(partial).length, 1, 'partial update writes exactly one column');
eq(partial.name, 'Renamed', 'partial update keeps the one field');
for (const [, col] of MAP) {
  if (col === 'name') continue;
  ok(!(col in partial), `partial update does NOT touch ${col}`);
}

// Explicit `undefined` values must behave the same as absent keys.
const explicitUndef = fieldsToRow({ name: 'X', segments: undefined, analysis: undefined }, true);
ok(!('segments' in explicitUndef), 'explicit undefined segments omitted');
ok(!('analysis' in explicitUndef), 'explicit undefined analysis omitted');
eq(Object.keys(explicitUndef).length, 1, 'only the defined field survives');

// RED proof for Contract 1: the buggy no-guard variant would copy undefined.
function noGuardBuggy(fields) {
  return { segments: fields.segments, name: fields.name };
}
const buggy = noGuardBuggy({ name: 'X' });
ok('segments' in buggy, 'sanity: buggy no-guard variant DOES leak undefined segments');
ok(!('segments' in explicitUndef), 'real mapper differs from the buggy no-guard variant');

// ── falsy-but-defined values must be preserved (guard is `!== undefined`) ──
const falsy = fieldsToRow({ step: 0, hideUnintelligible: false, translationEnabled: false }, true);
eq(falsy.step, 0, 'step 0 preserved (not dropped as falsy)');
eq(falsy.hide_unintelligible, false, 'hideUnintelligible false preserved');
eq(falsy.translation_enabled, false, 'translationEnabled false preserved');
eq(Object.keys(falsy).length, 3, 'all three falsy-but-defined fields written');

// ── Contract 3: slug schema gate ──
// hasSlug=false → slug column never written, even when provided.
const noSlugSchema = fieldsToRow({ name: 'A', slug: 'my-slug' }, false);
ok(!('slug' in noSlugSchema), 'hasSlug=false: slug column omitted');
eq(noSlugSchema.name, 'A', 'other fields still written when schema lacks slug');

// hasSlug=true → slug written.
const withSlug = fieldsToRow({ slug: 'my-slug' }, true);
eq(withSlug.slug, 'my-slug', 'hasSlug=true: slug written');

// empty-string slug coerces to null (never persist "").
const emptySlug = fieldsToRow({ slug: '' }, true);
ok('slug' in emptySlug, 'empty slug present as a key (was !== undefined)');
eq(emptySlug.slug, null, 'empty-string slug coerced to null');

// slug undefined → omitted regardless of schema flag.
const undefSlug = fieldsToRow({ name: 'A' }, true);
ok(!('slug' in undefSlug), 'undefined slug omitted even with hasSlug=true');

// RED proof for Contract 3: a variant that ignored the gate would leak slug.
function noGateBuggy(fields) {
  const row = {};
  if (fields.slug !== undefined) row.slug = fields.slug || null;
  return row;
}
ok('slug' in noGateBuggy({ slug: 's' }), 'sanity: no-gate variant leaks slug');
ok(!('slug' in noSlugSchema), 'real mapper respects the gate the buggy variant ignores');

// ── empty input → empty row, no throw ──
eq(Object.keys(fieldsToRow({}, true)).length, 0, 'empty fields → empty row');
eq(Object.keys(fieldsToRow({}, false)).length, 0, 'empty fields → empty row (no schema)');

console.log(`\nfields-to-row.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
