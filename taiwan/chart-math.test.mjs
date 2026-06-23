// Verifier lock for the Taiwan identity-polling chart math (taiwan/index.html).
//
// taiwan/ is a vite-served Newpress data-viz piece (Taiwan identity polling —
// squarely Johnny's content lane). Its progressive-reveal animation rides on
// four pure, self-contained, ZERO-coverage functions:
//   - mulberry32(a)        : the seeded PRNG behind the "organic wobble"
//   - buildFuturePath(...)  : the deterministic speculative-future projection;
//                             MUST land exactly on the target endVal
//   - easeOutCubic / easeInOutCubic : the reveal easings
//   - setData(progressLine, progressFuture) : the LOAD-BEARING one — maps the
//                             two animation progress floats onto the chart's
//                             history+future data arrays with linear
//                             interpolation at the moving frontier.
// A regression in setData's frontier interpolation, the future-after-history
// gate, or buildFuturePath's land-on-target visibly MIS-DRAWS a public chart,
// with no signal. No live bug found — this is a verifier-layer LOCK (same
// standard as the nile-flights / todo-planner / border-guesser inline-page
// locks). The test EXTRACTS the real shipped functions from index.html at
// runtime (brace-match + new Function), so it can't drift from a mirror.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, 'index.html'), 'utf8');

// ── runtime extractor: grab `function NAME(...) {...}` by brace-matching ──
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in index.html`);
  const braceOpen = src.indexOf('{', start);
  let depth = 0, i = braceOpen, inStr = null, inLineComment = false, inBlockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '*' && src[i + 1] === '/') { inBlockComment = false; i++; } continue; }
    if (inStr) { if (c === inStr && p !== '\\') inStr = null; continue; }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const TAIWAN_CONSTANTS = HTML; // alias for clarity

// Pull the real FUTURE_TICKS the page computes (Math.round(HIST_YEARS.length*0.5)).
// HIST_YEARS is series.map(r=>r[0]); count the series rows to derive it.
function deriveFutureTicks(src) {
  // series rows look like `[2014, 60.6, 32.5,  3.5,  3.5],` inside the series array.
  const m = src.match(/const series = \[([\s\S]*?)\n\s*\];/);
  assert.ok(m, 'series array not found');
  const rows = m[1].match(/\[\s*\d{4},/g) || [];
  return { histLen: rows.length, futureTicks: Math.round(rows.length * 0.5) };
}
const { histLen: HIST_LEN, futureTicks: FUTURE_TICKS } = deriveFutureTicks(HTML);

// ── materialize the real shipped functions ──
const mulberrySrc = extractFn(HTML, 'mulberry32');
const buildSrc = extractFn(HTML, 'buildFuturePath');
const setDataSrc = extractFn(HTML, 'setData');

// buildFuturePath closes over FUTURE_TICKS + mulberry32 → inject both into scope.
const buildFuturePath = new Function(
  'FUTURE_TICKS',
  `${mulberrySrc}\n${buildSrc}\nreturn buildFuturePath;`
)(FUTURE_TICKS);
const mulberry32 = new Function(`${mulberrySrc}\nreturn mulberry32;`)();

// setData closes over lines, chart, HIST_YEARS, FUTURE_TICKS → inject as params.
const makeSetData = new Function(
  'lines', 'chart', 'HIST_YEARS', 'FUTURE_TICKS',
  `${setDataSrc}\nreturn setData;`
);

// easings (one-line `function NAME(t){ return EXPR }`)
const easeOutCubic = new Function(`${extractFn(HTML, 'easeOutCubic')}\nreturn easeOutCubic;`)();
const easeInOutCubic = new Function(`${extractFn(HTML, 'easeInOutCubic')}\nreturn easeInOutCubic;`)();

// ── test harness ──
let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.error(`✗ ${name}\n  ${e.message}`); } };
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Build a realistic `lines` + fake `chart` for setData, mirroring the page:
// 4 lines, each with a HIST_LEN-long hist[] and FUTURE_TICKS-long future[].
function makeLines() {
  return [
    { key: 'a', hist: Array.from({ length: HIST_LEN }, (_, i) => 60 - i), future: buildFuturePath(60 - (HIST_LEN - 1), 50, 0, 3.2) },
    { key: 'b', hist: Array.from({ length: HIST_LEN }, (_, i) => 30 + i * 0.1), future: buildFuturePath(30 + (HIST_LEN - 1) * 0.1, 30, 17, 2.6) },
  ];
}
function makeChart(lines) {
  const total = HIST_LEN + FUTURE_TICKS;
  return { data: { datasets: lines.map(() => ({ data: new Array(total).fill(123) })) } };
}

// ════════ mulberry32 ════════
T('mulberry32: deterministic for a given seed', () => {
  const r1 = mulberry32(42), r2 = mulberry32(42);
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2());
});
T('mulberry32: outputs in [0,1)', () => {
  const r = mulberry32(0xC0FFEE);
  for (let i = 0; i < 100; i++) { const v = r(); assert.ok(v >= 0 && v < 1, `out of range: ${v}`); }
});
T('mulberry32: different seeds diverge', () => {
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

// ════════ buildFuturePath ════════
T('buildFuturePath: returns FUTURE_TICKS-length array', () => {
  assert.equal(buildFuturePath(60, 50, 0, 3.2).length, FUTURE_TICKS);
});
T('buildFuturePath: LANDS EXACTLY on the target endVal (the force-terminal guarantee)', () => {
  for (const [s, e] of [[60, 50], [2.5, 20], [3.8, 0], [31.7, 30]]) {
    const out = buildFuturePath(s, e, 17, 2.6);
    assert.equal(out[out.length - 1], e, `did not land on ${e}`);
  }
});
T('buildFuturePath: deterministic — same args reproduce the exact wobble', () => {
  const a = buildFuturePath(62, 50, 34, 3.2);
  const b = buildFuturePath(62, 50, 34, 3.2);
  assert.deepEqual(a, b);
});
T('buildFuturePath: a different seedSalt changes the path', () => {
  const a = buildFuturePath(62, 50, 0, 3.2);
  const b = buildFuturePath(62, 50, 17, 3.2);
  assert.notDeepEqual(a, b);
});
T('buildFuturePath: all values finite + rounded to <=2 decimals', () => {
  for (const v of buildFuturePath(62, 50, 0, 3.2)) {
    assert.ok(Number.isFinite(v), `non-finite ${v}`);
    assert.ok(approx(v, +v.toFixed(2)), `not 2-dp: ${v}`);
  }
});
T('buildFuturePath: values stay near the baseline trend (within ~amplitude band)', () => {
  const start = 62, end = 50, amp = 3.2;
  const out = buildFuturePath(start, end, 0, amp);
  out.forEach((v, i) => {
    const t = (i + 1) / FUTURE_TICKS;
    const baseline = start + (end - start) * t;
    assert.ok(Math.abs(v - baseline) <= amp + 1, `point ${i} ${v} strayed past baseline ${baseline.toFixed(1)} ± ${amp}`);
  });
});

// ════════ easings ════════
T('easeOutCubic: endpoints 0→0, 1→1', () => {
  assert.ok(approx(easeOutCubic(0), 0));
  assert.ok(approx(easeOutCubic(1), 1));
});
T('easeOutCubic: monotonic increasing', () => {
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) { const v = easeOutCubic(t); assert.ok(v >= prev - 1e-9, `not monotonic at ${t}`); prev = v; }
});
T('easeInOutCubic: endpoints 0→0, 1→1, midpoint 0.5', () => {
  assert.ok(approx(easeInOutCubic(0), 0));
  assert.ok(approx(easeInOutCubic(1), 1));
  assert.ok(approx(easeInOutCubic(0.5), 0.5));
});
T('easeInOutCubic: symmetric — f(t) + f(1-t) === 1', () => {
  for (const t of [0.1, 0.25, 0.33, 0.4]) assert.ok(approx(easeInOutCubic(t) + easeInOutCubic(1 - t), 1, 1e-9), `asymmetric at ${t}`);
});

// ════════ setData (the load-bearing frontier interpolation) ════════
T('setData: progress (0,0) fills only the first history point, rest null', () => {
  const lines = makeLines(), chart = makeChart(lines);
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(0, 0);
  const arr = chart.data.datasets[0].data;
  assert.equal(arr[0], lines[0].hist[0]);
  for (let i = 1; i < arr.length; i++) assert.equal(arr[i], null, `index ${i} should be null`);
});
T('setData: full history (progressLine=HIST_LEN-1) fills indices 0..HIST_LEN-1, future region null', () => {
  const lines = makeLines(), chart = makeChart(lines);
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(HIST_LEN - 1, 0);
  const arr = chart.data.datasets[0].data;
  for (let i = 0; i < HIST_LEN; i++) assert.equal(arr[i], lines[0].hist[i], `history index ${i}`);
  for (let i = HIST_LEN; i < arr.length; i++) assert.equal(arr[i], null, `future index ${i} should be null`);
});
T('setData: clears stale points each call (the fill begins null)', () => {
  const lines = makeLines(), chart = makeChart(lines);
  // datasets pre-filled with 123 by makeChart — a single point reveal must wipe them
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(0, 0);
  assert.ok(!chart.data.datasets[0].data.includes(123), 'stale 123 sentinel survived');
});
T('setData: fractional progressLine interpolates the frontier history point', () => {
  const lines = makeLines(), chart = makeChart(lines);
  const frac = 0.5;
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(2 + frac, 0);
  const arr = chart.data.datasets[0].data;
  // indices 0..2 are exact history; index 3 is the interpolated frontier
  for (let i = 0; i <= 2; i++) assert.equal(arr[i], lines[0].hist[i]);
  const expected = lines[0].hist[2] + (lines[0].hist[3] - lines[0].hist[2]) * frac;
  assert.ok(approx(arr[3], expected), `frontier ${arr[3]} != ${expected}`);
  assert.equal(arr[4], null, 'beyond the frontier must stay null');
});
T('setData: future does NOT draw until history is fully revealed', () => {
  const lines = makeLines(), chart = makeChart(lines);
  // history only half-revealed but progressFuture > 0
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(Math.floor(HIST_LEN / 2), 5);
  const arr = chart.data.datasets[0].data;
  for (let i = HIST_LEN; i < arr.length; i++) assert.equal(arr[i], null, `future index ${i} drew too early`);
});
T('setData: full future (progressFuture=FUTURE_TICKS) fills the future region, ending on the target', () => {
  const lines = makeLines(), chart = makeChart(lines);
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(HIST_LEN - 1, FUTURE_TICKS);
  const arr = chart.data.datasets[0].data;
  for (let i = 0; i < FUTURE_TICKS; i++) assert.equal(arr[HIST_LEN + i], lines[0].future[i], `future point ${i}`);
  // last point is the speculative target endVal (50 for line a)
  assert.equal(arr[arr.length - 1], lines[0].future[FUTURE_TICKS - 1]);
});
T('setData: history→future junction is contiguous (no NaN, no gap) mid-future', () => {
  const lines = makeLines(), chart = makeChart(lines);
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(HIST_LEN - 1, 3.5);
  const arr = chart.data.datasets[0].data;
  assert.equal(arr[HIST_LEN - 1], lines[0].hist[HIST_LEN - 1], 'last history point present');
  // first future cells filled (no null gap right after history)
  assert.notEqual(arr[HIST_LEN], null, 'first future cell is a gap');
  for (let i = HIST_LEN; i <= HIST_LEN + 3; i++) assert.ok(Number.isFinite(arr[i]), `non-finite at future cell ${i}: ${arr[i]}`);
});
T('setData: first future cell interpolates from the last history value (junction blend)', () => {
  const lines = makeLines(), chart = makeChart(lines);
  const frac = 0.4;
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(HIST_LEN - 1, frac); // fFloor=0
  const arr = chart.data.datasets[0].data;
  const prev = lines[0].hist[lines[0].hist.length - 1];
  const next = lines[0].future[0];
  const expected = prev + (next - prev) * frac;
  assert.ok(approx(arr[HIST_LEN], expected), `junction blend ${arr[HIST_LEN]} != ${expected}`);
});
T('setData: applies independently to every line/dataset', () => {
  const lines = makeLines(), chart = makeChart(lines);
  makeSetData(lines, chart, Array(HIST_LEN), FUTURE_TICKS)(HIST_LEN - 1, 0);
  assert.equal(chart.data.datasets[1].data[0], lines[1].hist[0]);
  assert.equal(chart.data.datasets[1].data[HIST_LEN - 1], lines[1].hist[HIST_LEN - 1]);
});

console.log(`\ntaiwan chart-math: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
