// Old-map overlay input resolution — pure, headless-testable.
//
// Accepts what a person actually pastes: an Allmaps annotation URL, an
// Allmaps viewer/editor share link, a bare Allmaps map id, or a raw XYZ
// tile template. Georeferenced paper maps (David Rumsey / OldMapsOnline /
// any IIIF collection) are served as standard XYZ tiles by the Allmaps
// tile proxy, so Mapbox can treat them as a plain raster source.

export const ALLMAPS_TILE_PROXY = 'https://allmaps.xyz/{z}/{x}/{y}.png?url=';

export function allmapsTiles(annotationUrl) {
  return ALLMAPS_TILE_PROXY + encodeURIComponent(annotationUrl);
}

// Classify a pasted string. Returns:
//   { kind: 'xyz',     tiles }                — ready to use
//   { kind: 'allmaps', annotation, tiles }    — annotation should be fetched
//                                               for label + bounds (optional)
//   null                                      — unusable input
export function classifyOldMapInput(raw) {
  const url = (raw || '').trim();
  if (!url) return null;

  // Raw XYZ tile template — the universal escape hatch.
  if (url.includes('{z}') && url.includes('{x}') && url.includes('{y}')) {
    return { kind: 'xyz', tiles: url };
  }

  // Bare Allmaps map id (16 hex chars).
  if (/^[0-9a-f]{16}$/i.test(url)) {
    const annotation = `https://annotations.allmaps.org/maps/${url.toLowerCase()}`;
    return { kind: 'allmaps', annotation, tiles: allmapsTiles(annotation) };
  }

  let u;
  try { u = new URL(url); } catch { return null; }

  // Allmaps viewer/editor share links carry the annotation in a ?url= param
  // (sometimes inside the hash: editor.allmaps.org/#/mask?url=…).
  const inner =
    u.searchParams.get('url') ||
    new URLSearchParams(u.hash.replace(/^#[^?]*\??/, '')).get('url');
  if (inner && /^https?:\/\//.test(inner)) {
    return { kind: 'allmaps', annotation: inner, tiles: allmapsTiles(inner) };
  }

  // Anything else: assume it's an annotation URL (annotations.allmaps.org,
  // or any server hosting a Georeference Annotation). The fetch validates it.
  return { kind: 'allmaps', annotation: url, tiles: allmapsTiles(url) };
}

// Pull the GCP items out of an annotation document — handles both a single
// Annotation and an AnnotationPage wrapper.
function annotationItems(doc) {
  if (!doc) return [];
  if (doc.type === 'AnnotationPage' && Array.isArray(doc.items)) return doc.items;
  return [doc];
}

// Geographic bounds of all ground-control points, padded outward — GCPs
// rarely sit on the sheet edges, so a bare GCP bbox under-frames the map.
export function annotationBounds(doc, padFrac = 0.25) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const item of annotationItems(doc)) {
    const features = item?.body?.features || [];
    for (const f of features) {
      const c = f?.geometry?.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lng, lat] = c;
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
  }
  if (!isFinite(minLng) || !isFinite(minLat)) return null;
  const padLng = Math.max((maxLng - minLng) * padFrac, 0.05);
  const padLat = Math.max((maxLat - minLat) * padFrac, 0.05);
  return [
    [Math.max(minLng - padLng, -179.9), Math.max(minLat - padLat, -85)],
    [Math.min(maxLng + padLng, 179.9), Math.min(maxLat + padLat, 85)],
  ];
}

// Human label from the annotation's IIIF lineage, if present.
export function annotationLabel(doc) {
  for (const item of annotationItems(doc)) {
    // partOf comes from arbitrary external annotation servers (David Rumsey,
    // OldMapsOnline, any IIIF). The spec's array form is common, but a single
    // Manifest/Canvas is often serialized as a bare object — iterating that with
    // for…of throws "partOf is not iterable" and fails an otherwise-valid map.
    // Coerce to an array (single object → one-element) so the label still reads;
    // any non-object (string/number/null) degrades to empty. Byte-identical for
    // the array case. Mirrors the Array.isArray guards in annotationItems/Bounds.
    const rawPartOf = item?.target?.source?.partOf;
    const partOf = Array.isArray(rawPartOf)
      ? rawPartOf
      : (rawPartOf && typeof rawPartOf === 'object' ? [rawPartOf] : []);
    for (const p of partOf) {
      const label = p?.label || p?.partOf?.[0]?.label;
      if (label) {
        const vals = Object.values(label).flat();
        if (vals.length && typeof vals[0] === 'string') return vals[0];
      }
    }
  }
  return null;
}
