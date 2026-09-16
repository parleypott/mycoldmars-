/**
 * config-for-project — ATTACHED CUT passthrough (cut dock). `script_projects.config.cut` rides the
 * row into the engine config as `cfg.cut` (via readCut: only a real url qualifies); absent or
 * malformed → null, so the engine mounts no dock and nothing else about the config changes.
 *
 * Run under bun: bun scripts-library/src/config-for-project-cut.test.mjs
 */
import { configForProject } from './config-for-project.js';

let pass = 0, fail = 0;
const eq = (got, want, label) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); } };

const uuid = '8d426a2b-3395-410e-89f5-0cfe41397ccf';
const cut = { url: 'https://example.test/cut.mp4', label: '260915 Assembly', duration: 2381.5 };

// new project with a cut → passthrough
eq(configForProject({ id: uuid, title: 'Burma Merge', config: { cut } }).cut, cut, 'new project: cut passes through');
// new project without → null, and the rest of the config is identical to the no-config shape
{
  const a = configForProject({ id: uuid, title: 'Burma Merge' });
  const b = configForProject({ id: uuid, title: 'Burma Merge', config: {} });
  eq(a.cut, null, 'new project: no cut → null');
  eq(b.cut, null, 'new project: empty config → null');
  const strip = (c) => { const { onPickerAdd, ...rest } = c; return rest; };
  eq(strip(a), strip(b), 'no-cut config identical with or without a config bag');
}
// malformed → null
eq(configForProject({ id: uuid, title: 'X', config: { cut: { url: '' } } }).cut, null, 'empty url → null');
eq(configForProject({ id: uuid, title: 'X', config: { cut: 'https://x' } }).cut, null, 'string cut → null');
// legacy episode gets the same passthrough; without it, null (Burma today)
eq(configForProject({ episode: 'burma' }).cut, null, 'legacy burma: no cut today');
eq(configForProject({ episode: 'burma', config: { cut } }).cut, cut, 'legacy burma: cut passes through when set');
// storage namespace untouched by the cut
eq(configForProject({ id: uuid, title: 'Burma Merge', config: { cut } }).storage.DOC, `script_${uuid}_doc_v1`, 'cut does not touch the storage namespace');

console.log(`config-for-project cut: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
