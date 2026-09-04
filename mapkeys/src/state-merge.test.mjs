// Lock the conflict merge (state-merge.js). Pure, load-bearing: it is the
// difference between "stale tab autosave silently deletes the river" and
// "stale tab adopts the river". Imports the REAL shipped function.
import { mergeProjectStates } from './state-merge.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗', msg); } }

const local = {
  shapes: [{ id: 's1', name: 'Polygon 1' }],
  overlays: [{ id: 'o1', name: 'wmts.oldmapsonline.org' }],
  layers: [],
  keyframes: [{ id: 'k1', shapes: { s1: { fillOpacity: 0.3 } } }],
  camera: { zoom: 5 },
  activeShapeId: 's1',
};
const cloud = {
  shapes: [{ id: 'river', name: 'Irrawaddy River' }, { id: 's1', name: 'Polygon 1 CLOUD-RENAMED' }],
  overlays: [{ id: 'o1', name: 'Mission Stations · 1893' }, { id: 'o2', name: 'Hindoostan · 1782' }],
  layers: [{ id: 'l9', name: 'route' }],
  keyframes: [{ id: 'k1', shapes: { river: { drawProgress: 1 }, s1: { fillOpacity: 0.9 } } }],
  camera: { zoom: 2 },
  activeShapeId: 'river',
};

const { state: m, adopted } = mergeProjectStates(local, cloud);

// THE incident, replayed: cloud-only entities must survive a stale save.
ok(m.shapes.some(s => s.id === 'river'), 'cloud-only shape (the river) survives');
ok(m.overlays.some(o => o.id === 'o2'), 'cloud-only overlay survives');
ok(m.layers.some(l => l.id === 'l9'), 'cloud-only layer survives');
ok(adopted === 3, `adopted counts cloud-only entities (got ${adopted})`);

// The active editor wins rows it knows about.
ok(m.shapes.find(s => s.id === 's1').name === 'Polygon 1', 'local wins on shared shape rows');
ok(m.overlays.find(o => o.id === 'o1').name === 'wmts.oldmapsonline.org', 'local wins on shared overlay rows');
ok(m.camera.zoom === 5 && m.activeShapeId === 's1', 'singular fields (camera, active ids) stay local');

// Cloud-only shapes stay ordered after local ones (bottom of top-first stack).
ok(m.shapes[0].id === 's1' && m.shapes[1].id === 'river', 'cloud-only rows append, never reorder local stack');

// Keyframes: local structure wins, but adopted shapes bring their kf entries.
ok(m.keyframes.length === 1 && m.keyframes[0].shapes.s1.fillOpacity === 0.3,
  'local keyframe entries win for local shapes');
ok(m.keyframes[0].shapes.river && m.keyframes[0].shapes.river.drawProgress === 1,
  'merged-in shape adopts its cloud keyframe entries');

// No-op direction: local superset of cloud → adopted 0, state unchanged shape-wise.
const noop = mergeProjectStates(cloud, { shapes: [{ id: 'river' }] });
ok(noop.adopted === 0, 'local superset → adopted 0');

// Degenerate inputs never throw and never invent entities.
const deg = mergeProjectStates(null, null);
ok(Array.isArray(deg.state.shapes) && deg.state.shapes.length === 0 && deg.adopted === 0,
  'null inputs → empty arrays, no adoption');
const noIds = mergeProjectStates({ shapes: [{ name: 'no-id' }] }, { shapes: [{ name: 'also-no-id' }] });
ok(noIds.state.shapes.length === 1, 'id-less cloud rows are not unioned (cannot dedupe them)');

console.log(`state-merge: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
