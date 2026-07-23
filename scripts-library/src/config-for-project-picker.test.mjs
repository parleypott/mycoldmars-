// Tests for config-for-project's PICKER augmentation — the per-project timecode DAY / SEQUENCE
// additions (script_projects.config.picker) merged into the episode config the engine reads.
//
// Contract locked here:
//   1. A project's persisted `config.picker.days` augment the config's built-in days (never replace),
//      for BOTH new-style library projects AND legacy Burma/Palau rows.
//   2. `config.picker.sequences` surface as `pickerSequences` on the episode config (the picker shows
//      them alongside the doc-derived ones).
//   3. `onPickerAdd(kind, value)` is wired so the engine can persist a live add (round-trips through
//      project-store.patchPickerEntry, exercised in project-store-picker.test.mjs).
//   4. A row with NO config still yields a clean, working config (defaults, empty pickerSequences).
//
// Run: bun scripts-library/src/config-for-project-picker.test.mjs
import { configForProject } from './config-for-project.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${label}: got ${g} want ${w}`); }
};
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log(`FAIL ${label}`); } };

// ── 1. NEW-STYLE library project: no config → defaults, empty pickerSequences, add hook present ──
{
  const cfg = configForProject({ id: '11111111-1111-1111-1111-111111111111', title: 'Nile' });
  eq(cfg.days, [1, 2, 3], 'default days when no config');
  eq(cfg.pickerSequences, [], 'empty pickerSequences when no config');
  ok(typeof cfg.onPickerAdd === 'function', 'onPickerAdd wired');
}

// ── 2. NEW-STYLE with persisted additions: days augmented, sequences surfaced ──
{
  const row = {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'Nile',
    config: { picker: { days: [4, 5], sequences: ['Boatman - Interview:'] } },
  };
  const cfg = configForProject(row);
  eq(cfg.days, [1, 2, 3, 4, 5], 'added days 4,5 merged onto defaults');
  eq(cfg.pickerSequences, ['Boatman - Interview:'], 'saved sequence surfaced');
}

// ── 3. LEGACY Burma row: hardcoded days stay the base, additions ride on top ──
{
  const base = configForProject({ episode: 'burma', slug: 'burma' });
  eq(base.days, [1, 2, 3], 'Burma keeps its built-in days with no additions');
  eq(base.pickerSequences, [], 'Burma has empty pickerSequences by default');
  ok(typeof base.onPickerAdd === 'function', 'Burma (legacy) also gets the add hook');

  const withAdd = configForProject({ episode: 'burma', slug: 'burma', config: { picker: { days: [4] } } });
  eq(withAdd.days, [1, 2, 3, 4], 'Burma day 4 added on top of its built-ins');
}

// ── 4. LEGACY Palau (days 1-7): a further-out day merges + sorts ──
{
  const cfg = configForProject({ episode: 'palau', slug: 'palau', config: { picker: { days: [8] } } });
  eq(cfg.days, [1, 2, 3, 4, 5, 6, 7, 8], 'Palau day 8 appended to its 7-day base');
}

// ── 5. Garbage config never throws; degrades to defaults ──
{
  const cfg = configForProject({ id: '33333333-3333-3333-3333-333333333333', title: 'X', config: { picker: 'nope' } });
  eq(cfg.days, [1, 2, 3], 'garbage picker → default days');
  eq(cfg.pickerSequences, [], 'garbage picker → empty pickerSequences');
}

// ── 6. Additions do not corrupt the pinned legacy namespace (data-integrity belt) ──
{
  const cfg = configForProject({ episode: 'burma', slug: 'burma', config: { picker: { days: [4] } } });
  eq(cfg.storage.DOC, 'wp01_burma_doc_v1', 'Burma doc namespace untouched by picker merge');
}

if (fail === 0) console.log(`PASS — all ${pass} config-for-project picker cases correct`);
else { console.log(`FAIL — ${fail} of ${pass + fail} config-for-project picker cases failed`); process.exit(1); }
