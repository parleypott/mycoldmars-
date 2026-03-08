/**
 * Layered gallery — tall scrolling canvas (3x viewport height).
 * Auto-scrolls down then back up, looping forever.
 *
 * Each layer's clip-path is driven by continuous sine waves —
 * always moving, never stopping. No states, no easing, just
 * slow perpetual drift. When a layer closes enough, it swaps media.
 */

const LAYER_COUNT = 36;
const PAGE_HEIGHT = 300;
const SCROLL_SPEED = 0.35;
const KB = ['kb-zoom-in', 'kb-zoom-out', 'kb-pan-left', 'kb-pan-right', 'kb-pan-up'];

function sizeForIndex(i) {
  if (i < 8) return { w: 60 + Math.random() * 40, hVh: 50 + Math.random() * 55 };
  if (i < 20) return { w: 25 + Math.random() * 45, hVh: 25 + Math.random() * 45 };
  return { w: 12 + Math.random() * 30, hVh: 12 + Math.random() * 30 };
}

class LayerController {
  constructor(el, pool, index, stageHeightVh) {
    this.el = el;
    this.pool = pool;
    this.index = index;
    this.stageHeightVh = stageHeightVh;
    this.mediaIdx = Math.floor(Math.random() * pool.length);
    this.mediaEl = null;
    this.swapped = false;

    // Each clip side gets its own sine wave: amplitude, frequency, phase, center
    // This creates continuously evolving, organic clip motion
    this.waves = {};
    for (const side of ['t', 'r', 'b', 'l']) {
      this.waves[side] = {
        // Center: where the clip oscillates around (0 = fully open, 50 = half clipped)
        center: 5 + Math.random() * 25,
        // Amplitude: how far it swings
        amp: 8 + Math.random() * 25,
        // Frequency: how fast it moves (radians per frame)
        // Back layers slower, front layers faster
        freq: (0.001 + Math.random() * 0.003) * (index < 8 ? 0.6 : index < 20 ? 1.0 : 1.5),
        // Phase offset so all sides move independently
        phase: Math.random() * Math.PI * 2,
        // Second harmonic for organic feel
        freq2: (0.0005 + Math.random() * 0.002) * (index < 8 ? 0.5 : 1.0),
        phase2: Math.random() * Math.PI * 2,
        amp2: 4 + Math.random() * 12,
      };
    }

    this.t = Math.random() * 10000; // start at random time offset
    this.setRandomBounds();
    this.loadMedia();
  }

  setRandomBounds() {
    const size = sizeForIndex(this.index);
    const hPct = (size.hVh / this.stageHeightVh) * 100;
    const x = -5 + Math.random() * (105 - size.w);
    const y = Math.random() * (100 - hPct);
    this.el.style.left = x + '%';
    this.el.style.top = y + '%';
    this.el.style.width = size.w + '%';
    this.el.style.height = hPct + '%';
  }

  loadMedia() {
    const media = this.pool[this.mediaIdx];
    if (this.mediaEl) {
      if (this.mediaEl.tagName === 'VIDEO') {
        this.mediaEl.pause();
        this.mediaEl.removeAttribute('src');
        this.mediaEl.load();
      }
      this.mediaEl.remove();
    }

    if (media.type === 'video' && media.src) {
      const v = document.createElement('video');
      v.src = media.src;
      v.autoplay = true;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      this.mediaEl = v;
    } else if (media.src) {
      const img = document.createElement('img');
      img.src = media.src;
      img.alt = '';
      this.mediaEl = img;
    } else {
      const d = document.createElement('div');
      d.style.cssText = `width:100%;height:100%;background:${media.color || '#1a1a2e'}`;
      this.mediaEl = d;
    }

    this.mediaEl.className = `layer-media ${KB[Math.floor(Math.random() * KB.length)]}`;
    this.el.appendChild(this.mediaEl);
  }

  nextMedia() {
    let next;
    do { next = Math.floor(Math.random() * this.pool.length); }
    while (next === this.mediaIdx && this.pool.length > 1);
    this.mediaIdx = next;
    this.loadMedia();
    // Reposition on swap
    this.setRandomBounds();
    // Randomize wave params slightly so it doesn't repeat the same motion
    for (const side of ['t', 'r', 'b', 'l']) {
      const w = this.waves[side];
      w.center = 5 + Math.random() * 25;
      w.amp = 8 + Math.random() * 25;
      w.phase += Math.random() * Math.PI;
      w.amp2 = 4 + Math.random() * 12;
    }
  }

  tick() {
    this.t++;

    let sumClip = 0;
    const clip = {};

    for (const side of ['t', 'r', 'b', 'l']) {
      const w = this.waves[side];
      // Two layered sine waves for organic motion
      const val = w.center
        + Math.sin(this.t * w.freq + w.phase) * w.amp
        + Math.sin(this.t * w.freq2 + w.phase2) * w.amp2;
      // Clamp to 0–80 range
      clip[side] = Math.max(0, Math.min(80, val));
      sumClip += clip[side];
    }

    // If all sides are very clipped (mostly hidden), swap media
    if (sumClip > 240 && !this.swapped) {
      this.swapped = true;
      this.nextMedia();
    }
    if (sumClip < 200) {
      this.swapped = false;
    }

    if (this.mediaEl) {
      this.mediaEl.style.clipPath =
        `inset(${clip.t}% ${clip.r}% ${clip.b}% ${clip.l}%)`;
    }
  }

  destroy() {
    if (this.mediaEl) {
      if (this.mediaEl.tagName === 'VIDEO') {
        this.mediaEl.pause();
        this.mediaEl.removeAttribute('src');
        this.mediaEl.load();
      }
      this.mediaEl.remove();
    }
  }
}

export function createGridGallery(mediaList, container) {
  const scroller = document.createElement('div');
  scroller.className = 'layer-scroller';

  const stage = document.createElement('div');
  stage.className = 'layer-stage';

  const controllers = [];

  for (let i = 0; i < LAYER_COUNT; i++) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.style.zIndex = i;
    stage.appendChild(layer);
    controllers.push(new LayerController(layer, mediaList, i, PAGE_HEIGHT));
  }

  scroller.appendChild(stage);
  container.appendChild(scroller);

  let scrollPos = 0;
  let scrollDir = 1;

  let rafId;
  function loop() {
    for (let i = 0; i < controllers.length; i++) controllers[i].tick();

    const max = scroller.scrollHeight - scroller.clientHeight;
    if (max > 0) {
      scrollPos += SCROLL_SPEED * scrollDir;
      if (scrollPos >= max) { scrollPos = max; scrollDir = -1; }
      if (scrollPos <= 0) { scrollPos = 0; scrollDir = 1; }
      scroller.scrollTop = scrollPos;
    }

    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      controllers.forEach(c => c.destroy());
      scroller.remove();
    }
  };
}

export function destroyGridGallery(scene) {
  if (scene) scene.destroy();
}
