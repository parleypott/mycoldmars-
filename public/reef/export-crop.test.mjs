// Verifier-layer test for the reef EXPORTER's crop math (export.js `drawCrop`).
//
// The player (index.html) frames each frame with a CSS transform:
//     translate(x*maxTx, y*maxTy) scale(s)   with maxTx = (s-1)/2 * viewportW
// so pan is stored as a FRACTION of the legal max-translate (locked separately in
// framing-math.test.mjs). The EXPORTER cannot replay a CSS transform — it bakes
// pixels — so export.js carries a SECOND, independent representation of the same
// framing: a source-rectangle crop
//     sw = W0/s,  scx = W0/2 * (1 - x*(s-1)/s),  sx0 = clamp(scx - sw/2, 0, W0-sw)
// fed to ctx.drawImage. If that crop ever drifts from the player's transform, every
// exported frame silently stops matching what Johnny framed on screen — and nothing
// on the headless path can catch it.
//
// This test CROSS-LOCKS the two divergent copies. It runs the REAL `drawCrop`
// (extracted verbatim from export.js, driven with a stub 2d context that captures the
// drawImage source rect) and compares it, across a grid of framings and viewports, to
// the visible source rectangle that the player's transform (its `maxTx` formula
// extracted verbatim from index.html) actually reveals. Contracts:
//
//   1. EQUIVALENCE — for any interior framing, export's crop rect == the player's
//      visible source rect, and it is VIEWPORT-INDEPENDENT (the whole point of the
//      fraction model: a frame locked on a laptop exports identically).
//   2. NO OFF-IMAGE READ (export's no-black-bars) — the clamp keeps the crop fully
//      inside [0..W0]x[0..H0] for ANY framing, incl. out-of-range pans.
//   3. PAN DIRECTION + CENTERING — x=0 is centered; x>0 shows the LEFT of the source
//      (matching translateX>0 revealing the image's left), x<0 the right.
//
// Mutation proofs at the bottom verify the lock has teeth.

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const here = new URL('.', import.meta.url);
const exportSrc = readFileSync(new URL('./export.js', here), 'utf8');
const indexSrc = readFileSync(new URL('./index.html', here), 'utf8');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const near = (a, b, msg) => { assert.ok(Math.abs(a - b) < 1e-6, `${msg} (got ${a}, want ${b})`); passed++; };

// --- extract the REAL drawCrop from export.js and drive it with a stub ctx --------
const clampSrc = exportSrc.match(/const clamp = .*/);
assert.ok(clampSrc, 'could not find clamp in export.js');
const drawCropSrc = exportSrc.match(/function drawCrop\([\s\S]*?\n\}/);
assert.ok(drawCropSrc, 'could not find drawCrop in export.js');

const makeDrawCrop = new Function(`${clampSrc[0]}\n${drawCropSrc[0]}\nreturn drawCrop;`);
const drawCrop = makeDrawCrop();

// return the source rect {sx0, sy0, sw, sh} export.js would crop for framing fr.
function exportCrop(fr, W0, H0, OUT_W = 2560, OUT_H = 1440) {
  let cap = null;
  const ctx = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    clearRect() {},
    drawImage(_img, sx0, sy0, sw, sh) { cap = { sx0, sy0, sw, sh }; },
  };
  const img = { naturalWidth: W0, naturalHeight: H0 };
  drawCrop(ctx, img, fr, OUT_W, OUT_H);
  assert.ok(cap, 'drawCrop never called ctx.drawImage');
  return cap;
}

// --- reconstruct the PLAYER's visible source rect from its extracted transform ----
// maxTx = (f.s - 1) / 2 * W  (verbatim from index.html); transform is
// `translate(tx,ty) scale(s)` about the element center. For a viewport of width Wv
// showing a source of width W0 (cover, matched aspect), a source point p maps to
// viewport v = (p/W0)*Wv, then v' = Wv/2 + s*(v - Wv/2) + tx. The visible source
// interval is the p for which v' in [0, Wv].
const maxTxSrc = indexSrc.match(/const maxTx = (\(f\.s - 1\) \/ 2 \* W), maxTy = (\(f\.s - 1\) \/ 2 \* H);/);
assert.ok(maxTxSrc, 'could not find the player maxTx/maxTy formula in index.html');
const playerMaxTx = new Function('f', 'W', `return ${maxTxSrc[1]};`);
const playerMaxTy = new Function('f', 'H', `return ${maxTxSrc[2]};`);

function playerVisibleSource(fr, W0, H0, Wv, Hv) {
  const s = fr.s;
  const tx = fr.x * playerMaxTx(fr, Wv);
  const ty = fr.y * playerMaxTy(fr, Hv);
  // invert v' = Wv/2 + s*(v - Wv/2) + tx  at v'=0 and v'=Wv, then v -> source
  const srcAt = (vpp, tt, size0, sizeV) => {
    const v = sizeV / 2 + (vpp - sizeV / 2 - tt) / s;
    return (v / sizeV) * size0;
  };
  const sx0 = srcAt(0, tx, W0, Wv);
  const sx1 = srcAt(Wv, tx, W0, Wv);
  const sy0 = srcAt(0, ty, H0, Hv);
  const sy1 = srcAt(Hv, ty, H0, Hv);
  return { sx0, sy0, sw: sx1 - sx0, sh: sy1 - sy0 };
}

const W0 = 2560, H0 = 1440;

// --- 1. EQUIVALENCE + VIEWPORT INDEPENDENCE (interior framings, no clamp) ----------
// Keep |x|,|y| small enough that neither the export clamp nor the viewport edge trims,
// so we test the raw mapping. Multiple viewports prove the crop is viewport-independent.
for (const Wv of [1280, 1920, 2560, 3840]) {
  const Hv = Wv * H0 / W0;                       // matched aspect
  for (const s of [1.0, 1.25, 1.8, 2.5, 3.0]) {
    for (const x of [-0.5, -0.2, 0, 0.3, 0.6]) {
      for (const y of [-0.4, 0, 0.5]) {
        const fr = { s, x, y };
        const e = exportCrop(fr, W0, H0);
        const p = playerVisibleSource(fr, W0, H0, Wv, Hv);
        near(e.sw, p.sw, `visible width matches player (s=${s})`);
        near(e.sh, p.sh, `visible height matches player (s=${s})`);
        near(e.sx0, p.sx0, `crop left matches player (s=${s},x=${x},Wv=${Wv})`);
        near(e.sy0, p.sy0, `crop top matches player (s=${s},y=${y},Wv=${Wv})`);
      }
    }
  }
}

// --- 2. NO OFF-IMAGE READ: crop stays inside the source for ANY framing ------------
for (const s of [1.0, 1.5, 3.0]) {
  for (const x of [-5, -1, 0, 1, 5]) {           // incl. out-of-range pans
    for (const y of [-5, 0, 5]) {
      const e = exportCrop({ s, x, y }, W0, H0);
      ok(e.sx0 >= -1e-6 && e.sx0 + e.sw <= W0 + 1e-6, `crop x within source (s=${s},x=${x})`);
      ok(e.sy0 >= -1e-6 && e.sy0 + e.sh <= H0 + 1e-6, `crop y within source (s=${s},y=${y})`);
      ok(e.sw > 0 && e.sh > 0, `crop has positive area (s=${s})`);
    }
  }
}

// --- 3. PAN DIRECTION + CENTERING --------------------------------------------------
{
  const c = exportCrop({ s: 2, x: 0, y: 0 }, W0, H0);
  near(c.sx0 + c.sw / 2, W0 / 2, 'x=0 crop is horizontally centered');
  near(c.sy0 + c.sh / 2, H0 / 2, 'y=0 crop is vertically centered');
  near(c.sw, W0 / 2, 's=2 shows exactly half the source width');

  const left = exportCrop({ s: 2, x: 0.6, y: 0 }, W0, H0);
  const right = exportCrop({ s: 2, x: -0.6, y: 0 }, W0, H0);
  ok(left.sx0 < c.sx0, 'x>0 pans the crop toward the LEFT of the source (matches translateX>0)');
  ok(right.sx0 > c.sx0, 'x<0 pans the crop toward the RIGHT of the source');
}

// golden case (hand-verified against the CSS model): s=2, x=0.5 -> crop [320, 1600]
{
  const g = exportCrop({ s: 2, x: 0.5, y: 0 }, W0, H0);
  near(g.sx0, 320, 'golden crop left = 320');
  near(g.sw, 1280, 'golden crop width = 1280');
}

// --- mutation proofs: the lock must FAIL if drawCrop's math regresses ---------------
function mustThrow(fn, label) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  ok(threw, `MUTATION CAUGHT: ${label}`);
}
// a drawCrop that forgets the pan term (scx = W0/2) diverges from the player crop
mustThrow(() => {
  const bad = new Function(`${clampSrc[0]}
    function drawCrop(ctx, img, fr, OUT_W, OUT_H) {
      const W0 = img.naturalWidth, H0 = img.naturalHeight, s = fr.s;
      const sw = W0 / s, sh = H0 / s;
      const scx = W0 / 2, scy = H0 / 2;                       // BUG: pan dropped
      let sx0 = clamp(scx - sw / 2, 0, W0 - sw), sy0 = clamp(scy - sh / 2, 0, H0 - sh);
      ctx.drawImage(img, sx0, sy0, sw, sh, 0, 0, OUT_W, OUT_H);
    }
    return drawCrop;`)();
  let cap = null;
  bad({ drawImage: (_i, sx0, sy0, sw, sh) => { cap = { sx0, sy0, sw, sh }; } },
      { naturalWidth: W0, naturalHeight: H0 }, { s: 2, x: 0.5, y: 0 }, 2560, 1440);
  const p = playerVisibleSource({ s: 2, x: 0.5, y: 0 }, W0, H0, 1920, 1080);
  assert.ok(Math.abs(cap.sx0 - p.sx0) < 1e-6, 'pan-dropped crop must NOT match player');
}, 'dropping the pan term breaks player equivalence');
// a drawCrop that forgets to divide by s (sw = W0) reads off-image / wrong zoom
mustThrow(() => {
  const bad = new Function(`${clampSrc[0]}
    function drawCrop(ctx, img, fr, OUT_W, OUT_H) {
      const W0 = img.naturalWidth, H0 = img.naturalHeight, s = fr.s;
      const sw = W0, sh = H0;                                 // BUG: no zoom
      const scx = (W0 / 2) * (1 - (fr.x * (s - 1)) / s), scy = (H0 / 2) * (1 - (fr.y * (s - 1)) / s);
      let sx0 = clamp(scx - sw / 2, 0, W0 - sw), sy0 = clamp(scy - sh / 2, 0, H0 - sh);
      ctx.drawImage(img, sx0, sy0, sw, sh, 0, 0, OUT_W, OUT_H);
    }
    return drawCrop;`)();
  let cap = null;
  bad({ drawImage: (_i, sx0, sy0, sw, sh) => { cap = { sx0, sy0, sw, sh }; } },
      { naturalWidth: W0, naturalHeight: H0 }, { s: 2, x: 0, y: 0 }, 2560, 1440);
  const p = playerVisibleSource({ s: 2, x: 0, y: 0 }, W0, H0, 1920, 1080);
  assert.ok(Math.abs(cap.sw - p.sw) < 1e-6, 'zoomless crop must NOT match player width');
}, 'dropping the /s zoom breaks player equivalence');

console.log(`reef export-crop: ${passed} assertions passed`);
