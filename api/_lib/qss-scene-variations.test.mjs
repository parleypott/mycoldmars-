// Lock for planActivation / planDeletion — the swap/delete math behind QSS Book
// View's "set this illustration active" (and "delete a variation") for Henry's
// scenes. Used by api/qss-story-scenes.js: the handler fetches the scene row,
// calls these to compute the PATCH body, writes it back. Henry-facing.
//
// Shipped with a DOCUMENTED bug history but NO test: the file's own comments
// warn that an earlier version "silently discarded a real image" when promoting
// a variation on a legacy/partial row that lacked active_variation_id. The whole
// point of the demote-the-current-primary block is that flipping illustrations
// must NEVER lose the one currently showing — Henry has to be able to flip back.
// A careless refactor could quietly reintroduce the loss; this pins the contract.
//
// Imports the REAL shipped fns — no mirror, can't drift.
import { planActivation, planDeletion } from './qss-scene-variations.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  if (got === want) { pass++; }
  else { fail++; console.error(`FAIL: ${msg}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const ok = (cond, msg) => eq(!!cond, true, msg);

const NOW = 1_700_000_000_000;

// ── planActivation: variation not found → error, state untouched ────────────
{
  const r = planActivation({ variations: [{ id: 'a' }] }, 'nope', NOW);
  eq(r.error, 'variation_not_found', 'activation: missing varId → error');
  eq(r.patch, undefined, 'activation: error result carries no patch');
}
eq(planActivation(null, 'x', NOW).error, 'variation_not_found', 'activation: null scene → error (guarded)');
eq(planActivation({ variations: 'bad' }, 'x', NOW).error, 'variation_not_found',
  'activation: non-array variations → treated as empty → error');

// ── planActivation: promote a variation, demote the current primary ─────────
{
  const scene = {
    image_url: 'PRIMARY.png',
    storage_path: 'p/primary',
    active_variation_id: 'orig-1',
    variations: [
      { id: 'v2', image_url: 'V2.png', storage_path: 'p/v2' },
      { id: 'v3', image_url: 'V3.png', storage_path: 'p/v3' },
    ],
  };
  const { patch } = planActivation(scene, 'v2', NOW);

  // Promoted variation becomes the primary slot.
  eq(patch.image_url, 'V2.png', 'activation: promoted image_url lands in primary');
  eq(patch.storage_path, 'p/v2', 'activation: promoted storage_path lands in primary');
  eq(patch.active_variation_id, 'v2', 'activation: active id = promoted id');

  // Promoted variation removed from alternates...
  ok(!patch.variations.some((v) => v.id === 'v2'), 'activation: promoted var dropped from alternates');
  // ...untouched alternate stays...
  ok(patch.variations.some((v) => v.id === 'v3' && v.image_url === 'V3.png'),
    'activation: other alternate preserved');
  // ...and the OLD primary is demoted into alternates, NEVER lost (the core contract).
  const demoted = patch.variations.find((v) => v.image_url === 'PRIMARY.png');
  ok(demoted, 'activation: old primary demoted into alternates (not discarded)');
  eq(demoted.id, 'orig-1', 'activation: demoted primary keeps its active_variation_id');
  eq(demoted.storage_path, 'p/primary', 'activation: demoted primary keeps its storage_path');

  // Source scene is not mutated in place.
  eq(scene.variations.length, 2, 'activation: source variations[] not mutated');
}

// ── planActivation: LEGACY row (no active_variation_id) — the documented bug ─
// The old guard pushed { id: scene.active_variation_id } which was undefined on
// legacy rows, so the demoted image either collided/was unaddressable. The fix
// synthesizes `orig-${now}`. Lock it: the original image must survive AND be
// addressable by a real (non-undefined) id.
{
  const scene = {
    image_url: 'LEGACY.png',
    // no storage_path, no active_variation_id — a real older row
    variations: [{ id: 'v2', image_url: 'V2.png' }],
  };
  const { patch } = planActivation(scene, 'v2', NOW);
  const demoted = patch.variations.find((v) => v.image_url === 'LEGACY.png');
  ok(demoted, 'activation(legacy): original image preserved, not discarded');
  eq(demoted.id, `orig-${NOW}`, 'activation(legacy): synthetic id, never undefined');
  ok(demoted.id != null, 'activation(legacy): demoted id is addressable');
  eq(demoted.storage_path, null, 'activation(legacy): missing storage_path → null');
  eq(patch.storage_path, null, 'activation(legacy): promoted var missing storage_path → null');
}

// ── planActivation: no current primary (image_url absent) → nothing to demote ─
{
  const scene = { variations: [{ id: 'v2', image_url: 'V2.png', storage_path: 'p/v2' }] };
  const { patch } = planActivation(scene, 'v2', NOW);
  eq(patch.variations.length, 0, 'activation: no primary → no synthetic demote');
  eq(patch.image_url, 'V2.png', 'activation: promotion still happens without a prior primary');
}

// ── planDeletion: drop varId, guard non-array, no-op on active id ────────────
{
  const scene = { variations: [{ id: 'v2' }, { id: 'v3' }] };
  const { patch } = planDeletion(scene, 'v2');
  eq(patch.variations.length, 1, 'deletion: removes the target variation');
  eq(patch.variations[0].id, 'v3', 'deletion: keeps the others');
}
{
  // Deleting the ACTIVE id is a no-op here — the active illustration lives in the
  // primary slot, not in variations[]. So nothing in alternates matches it.
  const scene = { active_variation_id: 'orig-1', image_url: 'P.png', variations: [{ id: 'v2' }] };
  const { patch } = planDeletion(scene, 'orig-1');
  eq(patch.variations.length, 1, 'deletion(active id): alternates untouched (active is in primary slot)');
}
eq(JSON.stringify(planDeletion(null, 'x').patch.variations), '[]',
  'deletion: null scene → empty variations (guarded, no crash)');
eq(JSON.stringify(planDeletion({ variations: 'bad' }, 'x').patch.variations), '[]',
  'deletion: non-array variations → empty (guarded)');
ok(!planDeletion({ variations: [{ id: 'v2' }] }, 'v2').patch.variations.some((v) => v.id === 'v2'),
  'deletion: target gone after delete');

console.log(`qss-scene-variations: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
