/**
 * Test for the ffprobe metadata parser that feeds media_uploads.fps, which
 * the Premiere XML export reads via getExportFps().
 *
 * The load-bearing case is "24000/1001" = 23.97602… — what ffprobe actually
 * reports for "23.976" footage. parseFrameRate must turn that rational into a
 * usable float (and reject "0/0" / garbage) or the worker would persist a
 * wrong/empty fps and the sequence would mislabel. Run with: bun this-file.
 */
import { parseFrameRate, parseProbeJson } from './ffprobe-meta.ts';

let pass = 0, fail = 0;
const EPS = 1e-6;

function approx(actual, expected, label) {
  if (typeof actual === 'number' && Math.abs(actual - expected) < EPS) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}: expected ≈${expected}, got ${actual}`);
}
function exact(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── parseFrameRate: the rationals ffprobe really emits ──────────────────
approx(parseFrameRate('24000/1001'), 24000 / 1001, '24000/1001 (the NTSC 23.976 case)');
approx(parseFrameRate('30000/1001'), 30000 / 1001, '30000/1001 (29.97)');
approx(parseFrameRate('60000/1001'), 60000 / 1001, '60000/1001 (59.94)');
approx(parseFrameRate('24/1'), 24, '24/1');
approx(parseFrameRate('25/1'), 25, '25/1');
approx(parseFrameRate('30/1'), 30, '30/1');
approx(parseFrameRate('  50/1 '), 50, 'whitespace tolerated');
approx(parseFrameRate('23.976'), 23.976, 'plain numeric string');

// ── parseFrameRate: the values that must degrade to null ────────────────
exact(parseFrameRate('0/0'), null, '0/0 → null (no usable rate)');
exact(parseFrameRate('0/1'), null, '0/1 → null');
exact(parseFrameRate(''), null, 'empty string → null');
exact(parseFrameRate('   '), null, 'whitespace-only → null');
exact(parseFrameRate('N/A'), null, 'N/A → null');
exact(parseFrameRate(null), null, 'null → null');
exact(parseFrameRate(undefined), null, 'undefined → null');
exact(parseFrameRate('garbage'), null, 'garbage → null');

// ── parseProbeJson: the full ffprobe -of json payload ───────────────────
const realPayload = JSON.stringify({
  streams: [{ r_frame_rate: '24000/1001', avg_frame_rate: '24000/1001', width: 1920, height: 1080 }],
});
const m1 = parseProbeJson(realPayload);
approx(m1?.fps, 24000 / 1001, 'json: fps from r_frame_rate');
exact(m1?.width, 1920, 'json: width');
exact(m1?.height, 1080, 'json: height');

// Falls back to avg_frame_rate when r_frame_rate is unusable.
const fallback = JSON.stringify({
  streams: [{ r_frame_rate: '0/0', avg_frame_rate: '30000/1001', width: 1280, height: 720 }],
});
approx(parseProbeJson(fallback)?.fps, 30000 / 1001, 'json: falls back to avg_frame_rate');

// Audio-only / no video stream / malformed → null, never throws.
exact(parseProbeJson(JSON.stringify({ streams: [] })), null, 'json: no streams → null');
exact(parseProbeJson('{not json'), null, 'json: malformed → null');
const noRate = parseProbeJson(JSON.stringify({ streams: [{ width: 640, height: 480 }] }));
exact(noRate?.fps, null, 'json: missing rate → fps null');
exact(noRate?.width, 640, 'json: width present even without fps');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
