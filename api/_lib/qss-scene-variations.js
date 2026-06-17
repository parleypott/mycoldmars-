// queen-scarlet-school: pure planning logic for scene illustration variations.
//
// Extracted from qss-story-scenes.js so the swap/delete math is unit-testable
// without a live Supabase. The handler fetches the scene row, calls these to
// compute the PATCH body, then writes it back (adding updated_at).
//
// Data model (server side):
//   The ACTIVE illustration lives in the row's primary slot
//     { image_url, storage_path, active_variation_id }
//   and is NOT duplicated inside variations[]. variations[] holds only the
//   inactive alternates. Activating one promotes it into the primary slot and
//   demotes the current primary back into variations[] so Henry can flip back.

/**
 * Plan the PATCH for set-active-variation.
 *
 * @param {object} scene  row with { variations, image_url, storage_path, active_variation_id }
 * @param {string} varId  id of the variation to promote
 * @param {number} now    timestamp for the demoted-primary's generated_at (injectable for tests)
 * @returns {{error: string}|{patch: object}}
 */
export function planActivation(scene, varId, now = Date.now()) {
  const variations = Array.isArray(scene?.variations) ? scene.variations : [];
  const target = variations.find((v) => v?.id === varId);
  if (!target) return { error: 'variation_not_found' };

  // Drop the promoted variation out of the alternates list...
  const nextVariations = variations.filter((v) => v?.id !== varId);

  // ...and demote the CURRENT primary into the alternates so it isn't lost.
  // The original first illustration always has an image_url; older/partial
  // rows may lack active_variation_id, so fall back to a synthetic id rather
  // than silently discarding a real image (the bug this guard used to have).
  if (scene?.image_url) {
    nextVariations.push({
      id: scene.active_variation_id || `orig-${now}`,
      image_url: scene.image_url,
      storage_path: scene.storage_path ?? null,
      generated_at: now,
    });
  }

  return {
    patch: {
      image_url: target.image_url,
      storage_path: target.storage_path || null,
      active_variation_id: varId,
      variations: nextVariations,
    },
  };
}

/**
 * Plan the PATCH for delete-variation: drop varId from the alternates.
 * (The active variation lives in the primary slot, not variations[], so
 * deleting the active id is a no-op here — by design.)
 *
 * @param {object} scene  row with { variations }
 * @param {string} varId  id of the variation to remove
 * @returns {{patch: {variations: any[]}}}
 */
export function planDeletion(scene, varId) {
  const variations = (Array.isArray(scene?.variations) ? scene.variations : []).filter(
    (v) => v?.id !== varId
  );
  return { patch: { variations } };
}
