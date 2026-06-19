// KML coordinate extraction for route import.
//
// Pulled out of main.js's parseKML so the coordinate parsing is testable
// without a live browser. Two real bugs lived in the old inline version,
// both fixed here:
//
//   1. The gx:Track fallback matched `getElementsByTagName('coord')`, but in
//      an XML document getElementsByTagName matches the QUALIFIED name — a
//      `<gx:coord>` element (the canonical gx:Track shape every GPS export
//      uses) has tagName "gx:coord", so 'coord' matched NOTHING. The whole
//      "flexible KML support" fallback was dead: a recorded GPS track imported
//      as zero coordinates and hit the "No usable LineString" alert. We now
//      match `gx:coord` (and a bare `coord`, for the rare non-namespaced file).
//
//   2. The gx path pushed coordinates with NO NaN guard, unlike the LineString
//      path. A malformed/empty coord line leaked [NaN, NaN] into the route,
//      poisoning every downstream haversine/distance with NaN. Now guarded.
//
// gx:coord is space-separated `lon lat [alt]`; <coordinates> tokens are
// comma-separated `lon,lat[,alt]`. Both yield [lng, lat].

export function parseLineStringToken(tok) {
  const parts = String(tok).split(',').map(Number);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]];
  return null;
}

export function parseGxCoordLine(text) {
  const parts = String(text).trim().split(/\s+/).map(Number);
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]];
  return null;
}

// Collect the gx:Track coordinate elements. getElementsByTagName('coord') does
// NOT match <gx:coord> in an XML document (qualified name), so check both —
// the namespaced gx:coord first, then any bare <coord> not already collected.
function gxCoordEls(doc) {
  const gx = Array.from(doc.getElementsByTagName('gx:coord'));
  const bare = Array.from(doc.getElementsByTagName('coord')).filter(e => !gx.includes(e));
  return gx.concat(bare);
}

export function extractKmlCoords(doc) {
  const out = [];
  const lineStrings = Array.from(doc.getElementsByTagName('LineString'));
  for (const ls of lineStrings) {
    const coordEl = ls.getElementsByTagName('coordinates')[0];
    if (!coordEl) continue;
    const tokens = (coordEl.textContent || '').trim().split(/\s+/);
    for (const tok of tokens) {
      const c = parseLineStringToken(tok);
      if (c) out.push(c);
    }
  }
  // Fall back to gx:Track / Track only when no LineString yielded anything.
  if (out.length === 0) {
    for (const el of gxCoordEls(doc)) {
      const c = parseGxCoordLine(el.textContent || '');
      if (c) out.push(c);
    }
  }
  return out;
}
