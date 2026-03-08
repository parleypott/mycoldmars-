/**
 * Layered gallery — tall scrolling canvas (3x viewport height).
 * Auto-scrolls down then back up, looping forever.
 *
 * Each layer's clip-path is driven by continuous sine waves —
 * always moving, never stopping. No states, no easing, just
 * slow perpetual drift. When a layer closes enough, it swaps media.
 *
 * The first ~6 layers are HUGE backdrop layers that guarantee
 * zero black space — they cover everything at all times.
 */

const LAYER_COUNT = 36;
const PAGE_HEIGHT = 300;
const SCROLL_SPEED = 0.35;
const KB = ['kb-zoom-in', 'kb-zoom-out', 'kb-pan-left', 'kb-pan-right', 'kb-pan-up'];

// Tier definitions: backdrop, back, mid, front
function tierForIndex(i) {
  if (i < 6)  return 'backdrop'; // massive, always visible, minimal clip
  if (i < 14) return 'back';     // large, slow drift
  if (i < 26) return 'mid';      // medium
  return 'front';                 // small accent
}

function sizeForIndex(i) {
  const tier = tierForIndex(i);
  switch (tier) {
    case 'backdrop': return { w: 110 + Math.random() * 50, hVh: 110 + Math.random() * 60 };
    case 'back':     return { w: 55 + Math.random() * 50, hVh: 45 + Math.random() * 60 };
    case 'mid':      return { w: 25 + Math.random() * 45, hVh: 25 + Math.random() * 45 };
    default:         return { w: 12 + Math.random() * 30, hVh: 12 + Math.random() * 30 };
  }
}

function waveParamsForIndex(index) {
  const tier = tierForIndex(index);
  switch (tier) {
    case 'backdrop': return {
      // Very small oscillation — these should almost always be fully open
      center: 1 + Math.random() * 4,   // oscillate around 1-5% (barely clipped)
      amp: 2 + Math.random() * 5,       // small swing
      freq: (0.0005 + Math.random() * 0.001), // very slow
      amp2: 1 + Math.random() * 3,
      freq2: (0.0003 + Math.random() * 0.0008),
      maxClip: 20,                       // never clip more than 20%
    };
    case 'back': return {
      center: 5 + Math.random() * 15,
      amp: 5 + Math.random() * 18,
      freq: (0.001 + Math.random() * 0.002) * 0.6,
      amp2: 3 + Math.random() * 10,
      freq2: (0.0005 + Math.random() * 0.0015) * 0.5,
      maxClip: 60,
    };
    case 'mid': return {
      center: 5 + Math.random() * 25,
      amp: 8 + Math.random() * 25,
      freq: (0.001 + Math.random() * 0.003),
      amp2: 4 + Math.random() * 12,
      freq2: (0.0005 + Math.random() * 0.002),
      maxClip: 80,
    };
    default: return {
      center: 5 + Math.random() * 25,
      amp: 8 + Math.random() * 25,
      freq: (0.001 + Math.random() * 0.003) * 1.5,
      amp2: 4 + Math.random() * 12,
      freq2: (0.0005 + Math.random() * 0.002),
      maxClip: 80,
    };
  }
}

class LayerController {
  constructor(el, pool, index, stageHeightVh) {
    this.el = el;
    this.pool = pool;
    this.index = index;
    this.tier = tierForIndex(index);
    this.stageHeightVh = stageHeightVh;
    this.mediaIdx = Math.floor(Math.random() * pool.length);
    this.mediaEl = null;
    this.swapped = false;

    // Each clip side gets its own sine wave
    this.waves = {};
    for (const side of ['t', 'r', 'b', 'l']) {
      const p = waveParamsForIndex(index);
      this.waves[side] = {
        center: p.center,
        amp: p.amp,
        freq: p.freq,
        phase: Math.random() * Math.PI * 2,
        freq2: p.freq2,
        phase2: Math.random() * Math.PI * 2,
        amp2: p.amp2,
        maxClip: p.maxClip,
      };
    }

    // Border overlay — same clip-path, renders as thin white edge
    this.borderEl = document.createElement('div');
    this.borderEl.className = 'layer-border';
    this.el.appendChild(this.borderEl);

    this.t = Math.random() * 10000;
    this.setRandomBounds();
    this.loadMedia();
  }

  setRandomBounds() {
    const size = sizeForIndex(this.index);
    const hPct = (size.hVh / this.stageHeightVh) * 100;

    if (this.tier === 'backdrop') {
      // Backdrop layers: centered, oversized, guaranteed coverage
      const x = -10 + Math.random() * (110 - size.w + 20);
      const y = Math.random() * (100 - hPct + 10);
      this.el.style.left = x + '%';
      this.el.style.top = y + '%';
    } else {
      const x = -5 + Math.random() * (105 - size.w);
      const y = Math.random() * Math.max(0, 100 - hPct);
      this.el.style.left = x + '%';
      this.el.style.top = y + '%';
    }
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
    this.setRandomBounds();
    // Randomize wave params slightly
    for (const side of ['t', 'r', 'b', 'l']) {
      const p = waveParamsForIndex(this.index);
      const w = this.waves[side];
      w.center = p.center;
      w.amp = p.amp;
      w.phase += Math.random() * Math.PI;
      w.amp2 = p.amp2;
    }
  }

  tick() {
    this.t++;

    let sumClip = 0;
    const clip = {};

    for (const side of ['t', 'r', 'b', 'l']) {
      const w = this.waves[side];
      const val = w.center
        + Math.sin(this.t * w.freq + w.phase) * w.amp
        + Math.sin(this.t * w.freq2 + w.phase2) * w.amp2;
      clip[side] = Math.max(0, Math.min(w.maxClip, val));
      sumClip += clip[side];
    }

    // Swap threshold depends on tier
    const swapThreshold = this.tier === 'backdrop' ? 50 : this.tier === 'back' ? 180 : 240;
    const resetThreshold = this.tier === 'backdrop' ? 30 : this.tier === 'back' ? 140 : 200;

    if (sumClip > swapThreshold && !this.swapped) {
      this.swapped = true;
      this.nextMedia();
    }
    if (sumClip < resetThreshold) {
      this.swapped = false;
    }

    if (this.mediaEl) {
      const cp = `inset(${clip.t}% ${clip.r}% ${clip.b}% ${clip.l}%)`;
      this.mediaEl.style.clipPath = cp;
      this.borderEl.style.clipPath = cp;
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
