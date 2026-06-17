// Tests for api/_lib/qss-scene-variations.js — the scene-illustration variation
// swap/delete planning logic behind QSS Book View. Imports the REAL shipped
// functions (no drift-prone mirror). Run: node api/qss-scene-variations.test.mjs
import { planActivation, planDeletion } from './_lib/qss-scene-variations.js';

let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; fails.push(`${msg}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

const NOW = 1_700_000_000_000;

// ── planActivation: the normal flow ──────────────────────────────────────
// Primary = A (active idA), alternates = [B, C]. Activate B.
{
  const scene = {
    image_url: 'A', storage_path: 'PA', active_variation_id: 'idA',
    variations: [
      { id: 'idB', image_url: 'B', storage_path: 'PB' },
      { id: 'idC', image_url: 'C', storage_path: 'PC' },
    ],
  };
  const { patch, error } = planActivation(scene, 'idB', NOW);
  ok(!error, 'normal activate: no error');
  eq(patch.image_url, 'B', 'normal activate: promotes B to primary image_url');
  eq(patch.storage_path, 'PB', 'normal activate: promotes B storage_path');
  eq(patch.active_variation_id, 'idB', 'normal activate: active id is B');
  // B removed from alternates; old primary A demoted in.
  eq(patch.variations.map(v => v.id), ['idC', 'idA'], 'normal activate: B out, A demoted in');
  const demoted = patch.variations.find(v => v.id === 'idA');
  eq(demoted, { id: 'idA', image_url: 'A', storage_path: 'PA', generated_at: NOW },
    'normal activate: demoted primary preserved with its image');
}

// ── planActivation: target not found ──────────────────────────────────────
{
  const scene = { image_url: 'A', active_variation_id: 'idA', variations: [{ id: 'idB', image_url: 'B' }] };
  eq(planActivation(scene, 'nope', NOW), { error: 'variation_not_found' }, 'missing target → variation_not_found');
}
{
  eq(planActivation({ image_url: 'A', active_variation_id: 'idA', variations: [] }, 'idB', NOW),
    { error: 'variation_not_found' }, 'empty alternates → variation_not_found');
  eq(planActivation({ image_url: 'A', variations: null }, 'idB', NOW),
    { error: 'variation_not_found' }, 'non-array variations → treated as empty → not_found');
}

// ── planActivation: THE LANDMINE FIX ──────────────────────────────────────
// Row has a primary image but NO active_variation_id (legacy / partial write).
// The OLD code (`if image_url && active_variation_id`) silently DROPPED the
// original image. The fix must preserve it under a synthetic id.
{
  const scene = {
    image_url: 'ORIG', storage_path: 'PORIG', active_variation_id: null,
    variations: [{ id: 'idB', image_url: 'B', storage_path: 'PB' }],
  };
  const { patch } = planActivation(scene, 'idB', NOW);
  eq(patch.image_url, 'B', 'landmine: B still promoted');
  const preserved = patch.variations.find(v => v.image_url === 'ORIG');
  ok(preserved, 'landmine: ORIGINAL image is NOT lost (preserved in alternates)');
  eq(preserved, { id: `orig-${NOW}`, image_url: 'ORIG', storage_path: 'PORIG', generated_at: NOW },
    'landmine: original demoted under synthetic id');
  // Inline RED proof: reconstruct the OLD guard and show it drops the original.
  const oldGuardKept = !!(scene.image_url && scene.active_variation_id);
  ok(!oldGuardKept, 'RED proof: old guard would have skipped preserving (active_variation_id falsy)');
}

// ── planActivation: no primary image yet (first-ever activation edge) ──────
// If somehow there's no primary image_url, nothing to demote — just promote.
{
  const scene = { image_url: null, active_variation_id: null, variations: [{ id: 'idB', image_url: 'B' }] };
  const { patch } = planActivation(scene, 'idB', NOW);
  eq(patch.variations, [], 'no primary: nothing demoted');
  eq(patch.active_variation_id, 'idB', 'no primary: B becomes active');
}

// ── planActivation: target missing storage_path → null ────────────────────
{
  const scene = { image_url: 'A', active_variation_id: 'idA', variations: [{ id: 'idB', image_url: 'B' }] };
  const { patch } = planActivation(scene, 'idB', NOW);
  eq(patch.storage_path, null, 'target without storage_path → null');
}

// ── planActivation: round-trip A→B→A preserves both images ────────────────
{
  let scene = {
    image_url: 'A', storage_path: 'PA', active_variation_id: 'idA',
    variations: [{ id: 'idB', image_url: 'B', storage_path: 'PB' }],
  };
  // A→B
  let { patch } = planActivation(scene, 'idB', NOW);
  scene = { ...scene, ...patch }; // simulate the DB write-back
  eq(scene.image_url, 'B', 'round-trip: now B is primary');
  // B→A (idA is back in alternates)
  ({ patch } = planActivation(scene, 'idA', NOW + 1));
  ok(!patch.error || patch.image_url, 'round-trip: idA findable after first swap');
  eq(patch.image_url, 'A', 'round-trip: A restored as primary');
  ok(patch.variations.some(v => v.image_url === 'B'), 'round-trip: B preserved in alternates');
}

// ── planDeletion ──────────────────────────────────────────────────────────
{
  const scene = { variations: [{ id: 'idB', image_url: 'B' }, { id: 'idC', image_url: 'C' }] };
  eq(planDeletion(scene, 'idB'), { patch: { variations: [{ id: 'idC', image_url: 'C' }] } },
    'delete: removes the named variation');
  eq(planDeletion(scene, 'nope'), { patch: { variations: scene.variations } },
    'delete: unknown id is a no-op');
  eq(planDeletion({ variations: null }, 'idB'), { patch: { variations: [] } },
    'delete: non-array variations → empty');
  eq(planDeletion({}, 'idB'), { patch: { variations: [] } },
    'delete: missing variations → empty');
}

// ── robustness: null/garbage scene ────────────────────────────────────────
{
  eq(planActivation(null, 'x', NOW), { error: 'variation_not_found' }, 'null scene → not_found, no throw');
  eq(planDeletion(null, 'x'), { patch: { variations: [] } }, 'null scene delete → empty, no throw');
}

console.log(`qss-scene-variations: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
