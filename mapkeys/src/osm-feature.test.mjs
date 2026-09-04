// Lock the OSM feature-search geometry plumbing (osm-feature.js). Pure,
// load-bearing: it turns Nominatim/Overpass responses into the coords and
// geometries that become real editable shapes — a silent regression here
// draws a river as spaghetti or drops a province entirely. Imports the REAL
// shipped functions (no mirror, can't drift).
import {
  mapNominatimResults, osmKindLabel, overpassLineSegments,
  stitchSegments, simplifyLine, geometryToPayload, mergeSearchResults,
} from './osm-feature.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }

/* ── mapNominatimResults ── */
{
  const rows = mapNominatimResults([
    { osm_type: 'relation', osm_id: 231955, name: 'Ayeyarwady River', display_name: 'Ayeyarwady River, Myanmar', category: 'waterway', type: 'river', lat: '21.5', lon: '95.2', boundingbox: ['16.1', '25.7', '94.8', '97.6'] },
    { osm_type: 'node', osm_id: 7, display_name: 'Hpakant, Kachin, Myanmar', category: 'place', type: 'town', lat: '25.6', lon: '96.3' },
    { osm_id: 9, name: 'no-type-dropped', lat: '1', lon: '1' },          // no osm_type
    { osm_type: 'way', osm_id: 10, name: 'bad-coords', lat: 'x', lon: 'y' }, // NaN coords
  ]);
  ok(rows.length === 2, 'drops rows lacking osm_type or finite coords');
  ok(rows[0].name === 'Ayeyarwady River' && rows[0].kind === 'river', 'river row: name + kind label');
  ok(rows[0].source === 'osm' && rows[0].osmType === 'relation' && rows[0].osmId === 231955, 'row carries osm identity');
  ok(rows[0].center[0] === 95.2 && rows[0].center[1] === 21.5, 'center is [lng,lat]');
  ok(JSON.stringify(rows[0].bbox) === JSON.stringify([94.8, 16.1, 97.6, 25.7]), 'bbox reordered to [w,s,e,n]');
  ok(rows[1].name === 'Hpakant', 'name falls back to first display_name segment');
  ok(rows[1].context === 'Kachin, Myanmar', 'context = next display_name segments');
  ok(osmKindLabel('boundary', 'administrative') === 'admin area', 'kind label table hit');
  ok(osmKindLabel('natural', 'volcanic_field') === 'volcanic field', 'kind label fallback humanizes raw type');
}

/* ── overpassLineSegments: main_stream filtering ── */
{
  const g = (pts) => pts.map(([lon, lat]) => ({ lon, lat }));
  const json = {
    elements: [
      { type: 'relation', id: 1, members: [
        { type: 'way', ref: 11, role: 'main_stream' },
        { type: 'way', ref: 12, role: 'side_stream' },
        { type: 'way', ref: 13, role: 'main_stream' },
      ] },
      { type: 'way', id: 11, geometry: g([[0, 10], [0, 9]]) },
      { type: 'way', id: 12, geometry: g([[5, 5], [6, 6]]) },
      { type: 'way', id: 13, geometry: g([[0, 9], [0, 8]]) },
    ],
  };
  const segs = overpassLineSegments(json);
  ok(segs.length === 2, 'side_stream member dropped when main_stream exists');
  // Untagged relation (no main_stream roles) keeps every way member.
  const untagged = {
    elements: [
      { type: 'relation', id: 1, members: [{ type: 'way', ref: 11, role: '' }, { type: 'way', ref: 12, role: '' }] },
      { type: 'way', id: 11, geometry: g([[0, 1], [0, 0]]) },
      { type: 'way', id: 12, geometry: g([[0, 0], [0, -1]]) },
    ],
  };
  ok(overpassLineSegments(untagged).length === 2, 'untagged relation keeps all way members');
  ok(overpassLineSegments({}).length === 0, 'empty/malformed response → []');
}

/* ── stitchSegments: order + flip + gap stop ── */
{
  // Three touching segments given shuffled + partly reversed; expect one
  // north→south chain with no duplicated joint points.
  const a = [[0, 10], [0, 9]];
  const b = [[0, 8], [0, 9]];       // reversed on purpose
  const c = [[0, 8], [0, 7]];
  const chain = stitchSegments([c, a, b]);
  ok(JSON.stringify(chain) === JSON.stringify([[0, 10], [0, 9], [0, 8], [0, 7]]),
    'stitches shuffled/reversed segments north→south, deduping joints');
  // A far-away segment (beyond maxGapDeg) must be dropped, not teleport-joined.
  const far = [[3, 3], [3, 2]];
  const chain2 = stitchSegments([a, b, far]);
  ok(chain2.length === 3 && chain2[chain2.length - 1][1] === 8, 'disconnected segment dropped at gap stop');
  ok(stitchSegments([]).length === 0 && stitchSegments(null).length === 0, 'degenerate input → []');
}

/* ── simplifyLine ── */
{
  // Collinear middle points vanish; a real corner survives.
  const line = [[0, 0], [0.0001, 1], [0, 2], [5, 2]];
  const simp = simplifyLine(line, 0.01);
  ok(JSON.stringify(simp) === JSON.stringify([[0, 0], [0, 2], [5, 2]]),
    'drops near-collinear points, keeps the corner');
  ok(simplifyLine([[1, 1], [2, 2]], 0.01).length === 2, 'sub-3-point input passes through');
  // Deep zigzag must not blow the stack (iterative DP).
  const big = [];
  for (let i = 0; i < 50000; i++) big.push([i * 0.001, (i % 2) * 0.01]);
  ok(simplifyLine(big, 1e-9).length === big.length, '50k-point worst case survives (iterative, keeps all)');
}

/* ── geometryToPayload ── */
{
  const line = geometryToPayload({ type: 'MultiLineString', coordinates: [[[0, 8], [0, 9]], [[0, 10], [0, 9]]] });
  ok(line && line.kind === 'line' && line.coords[0][1] === 10
    && line.coords[line.coords.length - 1][1] === 8,
    'MultiLineString → stitched north-first line payload (collinear mid collapses)');
  const pt = geometryToPayload({ type: 'Point', coordinates: [95.123456789, 21.98765] });
  ok(pt && pt.kind === 'point' && pt.center[0] === 95.12346, 'Point → rounded point payload');
  const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const area = geometryToPayload({ type: 'Polygon', coordinates: [ring] });
  ok(area && area.kind === 'area' && area.geometry.type === 'MultiPolygon'
    && area.geometry.coordinates[0][0].length >= 4,
    'Polygon → MultiPolygon area payload with intact ring');
  const multi = geometryToPayload({ type: 'MultiPolygon', coordinates: [[ring], [ring.map(([x, y]) => [x + 5, y])]] });
  ok(multi && multi.geometry.coordinates.length === 2, 'MultiPolygon keeps every polygon');
  ok(geometryToPayload({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }) === null, 'degenerate ring → null');
  ok(geometryToPayload(null) === null && geometryToPayload({ type: 'GeometryCollection' }) === null,
    'unsupported/absent geometry → null');
}

/* ── mergeSearchResults ── */
{
  const mb = [{ name: 'Myanmar', source: 'mapbox' }, { name: 'Mandalay', source: 'mapbox' }];
  const osm = [{ name: 'myanmar', source: 'osm' }, { name: 'Ayeyarwady River', source: 'osm' }];
  const merged = mergeSearchResults(mb, osm, 8);
  ok(merged.length === 3, 'dedupes OSM rows already present from Mapbox (case-insensitive)');
  ok(merged[0].source === 'mapbox' && merged[2].name === 'Ayeyarwady River', 'mapbox rows first, osm appended');
  ok(mergeSearchResults(mb, osm, 2).length === 2, 'limit respected');
  ok(mergeSearchResults(null, null).length === 0, 'degenerate input → []');
}

console.log(`osm-feature: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
