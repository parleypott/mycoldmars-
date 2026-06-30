// export.js — bake the reef loop out to GIF / MP4 / image-sequence.
// Self-contained ESM, lazy-loaded by index.html on demand. It reads the SAME
// data the player uses — manifest.json + saved framing + deletes from
// localStorage — so what you export is exactly what you framed on screen.
//
// Crop math (matches the player's CSS transform exactly):
//   source is W0xH0 (2560x1440). framing = { s, x, y }.
//   visible source rect:  sw = W0/s, sh = H0/s
//   center:  scx = W0/2 * (1 - x*(s-1)/s),  scy = H0/2 * (1 - y*(s-1)/s)
//   sx0 = scx - sw/2, sy0 = scy - sh/2  (then clamped into [0..W0-sw])

const FRAMING_STORE = 'reef_framing_v1';
const KILL_STORE = 'reef_killed_v2';
const S_MIN = 1.0, S_DEF = 1.5, S_MAX = 3.0;
const FPS = 12;                       // 12 images/sec — the loop's hard-cut rate

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let cancelFlag = false;

// ---- data -------------------------------------------------------------------
function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || ''); return v ?? fallback; } catch { return fallback; }
}
async function gatherFrames() {
  const manifest = await fetch('frames/manifest.json', { cache: 'no-cache' }).then((r) => r.json());
  const killed = new Set(readJSON(KILL_STORE, []));
  const framing = readJSON(FRAMING_STORE, {}) || {};
  return manifest
    .filter((m) => !killed.has(m.file))
    .map((m) => {
      const f = framing[m.file] || {};
      const s = clamp(Number.isFinite(f.s) ? f.s : S_DEF, S_MIN, S_MAX);
      const x = clamp(Number.isFinite(f.x) ? f.x : 0, -1, 1);
      const y = clamp(Number.isFinite(f.y) ? f.y : 0, -1, 1);
      return { file: m.file, name: m.name, w: m.w || 2560, h: m.h || 1440, s, x, y };
    });
}

function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('load failed: ' + url));
    im.src = url;
  });
}

// draw one frame's saved crop into ctx at OUT_W x OUT_H (full quality scale)
function drawCrop(ctx, img, fr, OUT_W, OUT_H) {
  const W0 = img.naturalWidth || fr.w, H0 = img.naturalHeight || fr.h;
  const s = fr.s;
  const sw = W0 / s, sh = H0 / s;
  const scx = (W0 / 2) * (1 - (fr.x * (s - 1)) / s);
  const scy = (H0 / 2) * (1 - (fr.y * (s - 1)) / s);
  let sx0 = scx - sw / 2, sy0 = scy - sh / 2;
  sx0 = clamp(sx0, 0, W0 - sw);
  sy0 = clamp(sy0, 0, H0 - sh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, OUT_W, OUT_H);
  ctx.drawImage(img, sx0, sy0, sw, sh, 0, 0, OUT_W, OUT_H);
}

const blobFrom = (canvas, type, q) =>
  new Promise((res) => canvas.toBlob((b) => res(b), type, q));

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// ---- UI ---------------------------------------------------------------------
let ui;
function ensureUI() {
  if (ui) return ui;
  ui = document.createElement('div');
  ui.id = 'reef-export';
  ui.innerHTML = `
    <div class="x-scrim"></div>
    <div class="x-panel">
      <div class="x-head">EXPORT</div>
      <div class="x-menu">
        <button data-act="seq"><b>Image sequence</b><span>full-res PNG frames → a folder you pick</span></button>
        <button data-act="mp4"><b>MP4</b><span>baked H.264, full res, the flicker loop</span></button>
        <button data-act="gif"><b>GIF</b><span>animated, 720p (gif can't do true hi-res)</span></button>
      </div>
      <div class="x-prog" hidden>
        <div class="x-msg">working…</div>
        <div class="x-bar"><i></i></div>
        <button class="x-cancel">cancel</button>
      </div>
      <button class="x-close" title="close (esc)">✕</button>
    </div>`;
  const css = document.createElement('style');
  css.textContent = `
    #reef-export { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center;
      font: 500 13px/1.4 ui-monospace, Menlo, monospace; color: #d4e2e1; }
    #reef-export .x-scrim { position: absolute; inset: 0; background: rgba(2,6,8,.72); backdrop-filter: blur(6px); }
    #reef-export .x-panel { position: relative; width: min(440px, 92vw); padding: 26px 24px 24px;
      background: #0c1417; border: 1px solid rgba(116,178,171,.25); border-radius: 16px; box-shadow: 0 24px 80px rgba(0,0,0,.6); }
    #reef-export .x-head { letter-spacing: .28em; font-size: 11px; color: #74b2ab; margin-bottom: 18px; }
    #reef-export .x-menu { display: flex; flex-direction: column; gap: 9px; }
    #reef-export .x-menu button { text-align: left; padding: 14px 16px; border-radius: 11px; cursor: pointer;
      background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.09); color: #d4e2e1;
      display: flex; flex-direction: column; gap: 3px; transition: background .12s, border-color .12s; }
    #reef-export .x-menu button:hover { background: rgba(46,111,106,.22); border-color: rgba(116,178,171,.5); }
    #reef-export .x-menu b { font-size: 14px; letter-spacing: .04em; }
    #reef-export .x-menu span { font-size: 11px; color: #6f8784; letter-spacing: .02em; }
    #reef-export .x-prog { margin-top: 8px; }
    #reef-export .x-msg { font-size: 12px; color: #9fcfc8; margin-bottom: 12px; min-height: 17px; }
    #reef-export .x-bar { height: 3px; background: #14201f; border-radius: 3px; overflow: hidden; }
    #reef-export .x-bar > i { display: block; height: 100%; width: 0%; background: #2e6f6a; transition: width .15s ease; }
    #reef-export .x-cancel { margin-top: 16px; background: transparent; border: 1px solid rgba(255,255,255,.14);
      color: #b9c6c5; padding: 7px 14px; border-radius: 8px; cursor: pointer; font: inherit; }
    #reef-export .x-cancel:hover { border-color: rgba(220,80,80,.6); color: #fff; }
    #reef-export .x-close { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%;
      background: transparent; border: none; color: #5b7572; font-size: 16px; cursor: pointer; }
    #reef-export .x-close:hover { color: #fff; }
  `;
  ui.appendChild(css);
  document.body.appendChild(ui);

  const close = () => hide();
  ui.querySelector('.x-scrim').addEventListener('click', close);
  ui.querySelector('.x-close').addEventListener('click', close);
  ui.querySelector('.x-cancel').addEventListener('click', () => { cancelFlag = true; setMsg('cancelling…'); });
  ui.querySelectorAll('.x-menu button').forEach((b) =>
    b.addEventListener('click', () => run(b.dataset.act)));
  return ui;
}
function show() { ensureUI(); ui.style.display = 'flex'; ui.querySelector('.x-menu').hidden = false; ui.querySelector('.x-prog').hidden = true; cancelFlag = false; }
function hide() { if (ui) ui.style.display = 'none'; }
function toProgress() { ui.querySelector('.x-menu').hidden = true; ui.querySelector('.x-prog').hidden = false; }
function setMsg(m) { ui && (ui.querySelector('.x-msg').textContent = m); }
function setBar(p) { ui && (ui.querySelector('.x-bar > i').style.width = Math.round(p * 100) + '%'); }

// ---- exporters --------------------------------------------------------------
async function run(act) {
  toProgress();
  cancelFlag = false;
  try {
    const frames = await gatherFrames();
    if (!frames.length) { setMsg('no frames to export'); return; }
    if (act === 'seq') await exportSequence(frames);
    else if (act === 'mp4') await exportMP4(frames);
    else if (act === 'gif') await exportGIF(frames);
  } catch (e) {
    console.error(e);
    setMsg('error: ' + (e && e.message ? e.message : e));
    return;
  }
  if (!cancelFlag) { setMsg('done ✓'); setBar(1); setTimeout(hide, 1100); }
  else setMsg('cancelled');
}

const OUT_W = 2560, OUT_H = 1440;

async function exportSequence(frames) {
  if (!window.showDirectoryPicker) {
    setMsg('image sequence needs Chrome (folder access). use MP4 instead.');
    throw new Error('no File System Access API');
  }
  setMsg('choose a folder…');
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  const cv = document.createElement('canvas'); cv.width = OUT_W; cv.height = OUT_H;
  const ctx = cv.getContext('2d');
  const pad = String(frames.length).length;
  for (let i = 0; i < frames.length; i++) {
    if (cancelFlag) return;
    const fr = frames[i];
    setMsg(`writing ${i + 1}/${frames.length} · ${fr.name}`);
    const img = await loadImage('frames/' + fr.file);
    drawCrop(ctx, img, fr, OUT_W, OUT_H);
    const blob = await blobFrom(cv, 'image/png');
    const fname = `reef_${String(i + 1).padStart(pad, '0')}.png`;
    const fh = await dir.getFileHandle(fname, { create: true });
    const ws = await fh.createWritable();
    await ws.write(blob); await ws.close();
    setBar((i + 1) / frames.length);
  }
}

async function exportMP4(frames) {
  if (!('VideoEncoder' in window)) {
    setMsg('MP4 needs a Chromium browser (WebCodecs). try image sequence.');
    throw new Error('no WebCodecs');
  }
  setMsg('loading encoder…');
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm');

  // pick a supported codec/size (drop to 1080p if 1440p config is rejected)
  const candidates = [
    { w: OUT_W, h: OUT_H, codec: 'avc1.640034' },
    { w: OUT_W, h: OUT_H, codec: 'avc1.640033' },
    { w: 1920, h: 1080, codec: 'avc1.640028' },
  ];
  let cfgPick = null;
  for (const c of candidates) {
    const cfg = { codec: c.codec, width: c.w, height: c.h, bitrate: 18_000_000, framerate: FPS };
    try { const sup = await VideoEncoder.isConfigSupported(cfg); if (sup && sup.supported) { cfgPick = c; break; } } catch {}
  }
  if (!cfgPick) { cfgPick = candidates[2]; }
  const W = cfgPick.w, H = cfgPick.h;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('encoder', e),
  });
  encoder.configure({ codec: cfgPick.codec, width: W, height: H, bitrate: 18_000_000, framerate: FPS });

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { alpha: false });
  const usPer = Math.round(1_000_000 / FPS);

  for (let i = 0; i < frames.length; i++) {
    if (cancelFlag) { try { encoder.close(); } catch {} return; }
    const fr = frames[i];
    setMsg(`encoding ${i + 1}/${frames.length} · ${fr.name}`);
    const img = await loadImage('frames/' + fr.file);
    drawCrop(ctx, img, fr, W, H);
    const vf = new VideoFrame(cv, { timestamp: i * usPer, duration: usPer });
    encoder.encode(vf, { keyFrame: i % 24 === 0 });
    vf.close();
    setBar((i + 1) / frames.length * 0.92);
    if (i % 6 === 5) await new Promise((r) => setTimeout(r)); // let the UI breathe
  }
  setMsg('finalizing mp4…');
  await encoder.flush();
  muxer.finalize();
  download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), `reef-loop_${frames.length}f.mp4`);
}

async function exportGIF(frames) {
  setMsg('loading gif encoder…');
  const { GIFEncoder, quantize, applyPalette } = await import('https://unpkg.com/gifenc@1.0.3/dist/gifenc.esm.js');
  const W = 1280, H = 720;                 // gif is palette-limited; 720p keeps it sane
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { alpha: false });
  const gif = GIFEncoder();
  const delay = Math.round(1000 / FPS);
  for (let i = 0; i < frames.length; i++) {
    if (cancelFlag) return;
    const fr = frames[i];
    setMsg(`gif frame ${i + 1}/${frames.length} · ${fr.name}`);
    const img = await loadImage('frames/' + fr.file);
    drawCrop(ctx, img, fr, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, W, H, { palette, delay, repeat: 0 });
    setBar((i + 1) / frames.length * 0.95);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  setMsg('packing gif…');
  gif.finish();
  download(new Blob([gif.bytesView()], { type: 'image/gif' }), `reef-loop_${frames.length}f.gif`);
}

// ---- public api -------------------------------------------------------------
export function openMenu() { show(); }
window.addEventListener('keydown', (e) => {
  if (ui && ui.style.display !== 'none' && e.key === 'Escape') { e.preventDefault(); hide(); }
});
