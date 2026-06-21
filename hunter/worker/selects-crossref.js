/**
 * Selects → raw clip-name cross-reference matching.
 *
 * The Hunter ingests a Premiere FCP7 "selects" sequence and cross-references
 * each edit decision against the raw-footage corpus units, so the editorial
 * embedding can describe WHICH raw clip a selects decision came from. The
 * tripwire (the whole reason fix-selects-crossref.mjs exists) is that the two
 * sides name the same physical clip differently:
 *   - Premiere (selects) uses the ORIGINAL clip name:   A001_C002.mov
 *   - Dropbox (raw)       uses a "_Proxy" suffix + maybe a different
 *     extension/case:                                    A001_C002_Proxy.MP4
 *
 * So a robust match must normalize BOTH names the same way. The old inline
 * matcher in ingest-selects.mjs keyed the raw map by 4 name variants but only
 * looked the selects name up by 2 (full + no-extension) — asymmetric, so a
 * selects name that itself carried "_Proxy" never matched. This module makes
 * the matching SYMMETRIC: both sides run through clipMatchKeys, so a name is
 * tried full → no-extension → no-_Proxy → no-_Proxy-no-extension, in
 * most-specific-first order.
 *
 * Additive-only: for the documented direction (selects = original, no _Proxy)
 * clipMatchKeys dedupes to exactly the old [full, noExt] pair, so existing
 * matches are byte-identical; the extra keys only ADD matches for the reverse
 * direction, never remove one.
 */

/**
 * Ordered, de-duplicated list of match keys for one clip name, most-specific
 * first: full → no-extension → no-_Proxy → no-_Proxy-no-extension.
 * A non-string returns [].
 */
export function clipMatchKeys(name) {
  if (typeof name !== 'string' || name === '') return [];
  const noExt = name.replace(/\.[^.]+$/, '');
  const noProxy = name.replace(/_Proxy/i, '');
  const noProxyNoExt = noExt.replace(/_Proxy/i, '');
  const out = [];
  for (const k of [name, noExt, noProxy, noProxyNoExt]) {
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Build a name → rawUnit lookup Map from the raw corpus units. Every variant
 * of a unit's source_clip_name maps back to that unit. Preserves the old
 * last-writer-wins semantics (units inserted in array order; a later unit
 * sharing a variant key overwrites an earlier one — matches the inline .set
 * behavior it replaces).
 */
export function buildRawUnitMatcher(rawUnits) {
  const map = new Map();
  for (const u of rawUnits || []) {
    if (!u) continue;
    for (const key of clipMatchKeys(u.source_clip_name)) {
      map.set(key, u);
    }
  }
  return map;
}

/**
 * Find the raw unit matching a selects-side clip name, trying the selects
 * name's variants most-specific-first. Returns the matched unit or null.
 */
export function findRawMatch(matcher, selectsName) {
  if (!matcher) return null;
  for (const key of clipMatchKeys(selectsName)) {
    const hit = matcher.get(key);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build a Set of EVERY match-key variant across a list of units'
 * source_clip_name. Used for the "which raw clips appear in selects?" membership
 * test in cross-tier-matching: the SELECTS side is normalized through the same
 * clipMatchKeys as the raw side, so membership is SYMMETRIC. The old inline Set
 * only stored {full, no-extension} of each selects name (never stripping
 * "_Proxy"), so a selects sequence edited with PROXY files (clip names carrying
 * "_Proxy", raw = camera originals without it) never matched — every
 * cross-reference missed. clipMatchKeys strips _Proxy on both sides, closing it.
 */
export function buildClipNameKeySet(units) {
  const set = new Set();
  for (const u of units || []) {
    if (!u) continue;
    for (const key of clipMatchKeys(u.source_clip_name)) set.add(key);
  }
  return set;
}

/**
 * Does any match-key variant of `name` appear in `keySet`? Symmetric counterpart
 * to buildClipNameKeySet — both sides go through clipMatchKeys.
 */
export function clipNameMatchesSet(keySet, name) {
  if (!keySet) return false;
  for (const key of clipMatchKeys(name)) {
    if (keySet.has(key)) return true;
  }
  return false;
}
