/**
 * Layered gallery — absolutely positioned media layers stacked on top
 * of each other. Big ones in back, small ones in front. All overlapping,
 * zero black space. Each layer independently reveals/morphs/hides and
 * swaps media from the pool. Huge variation in size, speed, crop, timing.
 */

const LAYER_COUNT = 18;
const KB = ['kb-zoom-in', 'kb-zoom-out', 'kb-pan-left', 'kb-pan-right', 'kb-pan-up'];

// Size tiers — back layers are huge, front layers are smaller
// [minW%, maxW%, minH%, maxH%]
const SIZE_TIERS = [
  // Back layers (0–5): massive, cover most of screen
  [80, 110, 70, 110],
  [70, 100, 60, 100],
  [65, 95, 55, 90],
  [60, 90, 50, 85],
  [55, 85, 50, 80],
  [50, 80, 45, 75],
  // Mid layers (6–11): medium
  [35, 65, 30, 60],
  [30, 60, 25, 55],
  [30, 55, 25, 50],
  [25, 50, 20, 50],
  [25, 50, 20, 45],
  [20, 45, 20, 45],
  // Front layers (12–17): smaller accents
  [15, 40, 15, 40],
  [15, 35, 15, 35],
  [12, 35, 12, 35],
  [12, 30, 12, 30],
  [10, 30, 10, 30],
  [10, 25, 10, 25],
];

// Speed tiers — back layers change slower, front layers faster
const SPEED_TIERS = [
  0.015, 0.018, 0.02, 0.02, 0.022, 0.025,  // back: slow
  0.028, 0.03, 0.032, 0.035, 0.038, 0.04,   // mid: medium
  0.04, 0.045, 0.05, 0.05, 0.055, 0.06,     // front: fast
];

// Hold time ranges per tier (frames at 60fps)
const HOLD_TIERS = [
  [400, 700], [380, 650], [350, 600], [320, 580], [300, 550], [280, 500], // back: long
  [200, 420], [180, 400], [160, 380], [150, 350], [140, 320], [130, 300], // mid: medium
  [100, 260], [90, 240], [80, 220], [70, 200], [60, 180], [50, 160],     // front: short
];

class LayerController {
  constructor(el, pool, index) {
    this.el = el;
    this.pool = pool;
    this.index = index;
    this.mediaIdx = Math.floor(Math.random() * pool.length);
    this.mediaEl = null;

    const tier = SIZE_TIERS[index];
    this.speed = SPEED_TIERS[index] * (0.7 + Math.random() * 0.6);

    // Clip: inset(top% right% bottom% left%)
    this.clip = { t: 100, r: 100, b: 100, l: 100 };
    this.target = { t: 100, r: 100, b: 100, l: 100 };

    this.state = 'waiting';
    // Stagger: back layers start sooner, front layers later
    this.timer = index * 8 + Math.floor(Math.random() * 60);
    this.morphs = 0;
    this.maxMorphs = 1 + Math.floor(Math.random() * 3);

    // Random position and size for this cycle
    this.setRandomBounds();
    this.loadMedia();
  }

  setRandomBounds() {
    const tier = SIZE_TIERS[this.index];
    const w = tier[0] + Math.random() * (tier[1] - tier[0]);
    const h = tier[2] + Math.random() * (tier[3] - tier[2]);
    // Position so it can extend beyond edges
    const x = -10 + Math.random() * (110 - w);
    const y = -10 + Math.random() * (110 - h);

    this.el.style.left = x + '%';
    this.el.style.top = y + '%';
    this.el.style.width = w + '%';
    this.el.style.height = h + '%';
  }

  randomCrop() {
    // Varied crops — sometimes wide sliver, sometimes almost full, sometimes corner
    const style = Math.random();

    if (style < 0.3) {
      // Nearly full reveal with slight random trim
      return {
        t: Math.random() * 8,
        r: Math.random() * 8,
        b: Math.random() * 8,
        l: Math.random() * 8,
      };
    } else if (style < 0.55) {
      // Horizontal strip (wide, short)
      const stripH = 15 + Math.random() * 35;
      return {
        t: stripH * Math.random(),
        r: Math.random() * 10,
        b: stripH * (1 - Math.random()),
        l: Math.random() * 10,
      };
    } else if (style < 0.75) {
      // Vertical strip (tall, narrow)
      const stripW = 15 + Math.random() * 35;
      return {
        t: Math.random() * 10,
        r: stripW * Math.random(),
        b: Math.random() * 10,
        l: stripW * (1 - Math.random()),
      };
    } else {
      // Asymmetric — 2–3 sides open, one heavily cropped
      const sides = ['t', 'r', 'b', 'l'];
      const crop = {};
      const heavy = Math.floor(Math.random() * 4);
      sides.forEach((s, i) => {
        crop[s] = i === heavy ? (20 + Math.random() * 45) : (Math.random() * 12);
      });
      return crop;
    }
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
    this.applyClip();
    this.el.appendChild(this.mediaEl);
  }

  nextMedia() {
    let next;
    do { next = Math.floor(Math.random() * this.pool.length); }
    while (next === this.mediaIdx && this.pool.length > 1);
    this.mediaIdx = next;
    this.loadMedia();
  }

  easeToTarget() {
    let done = true;
    for (const k of ['t', 'r', 'b', 'l']) {
      const diff = this.target[k] - this.clip[k];
      if (Math.abs(diff) > 0.2) {
        this.clip[k] += diff * this.speed;
        done = false;
      } else {
        this.clip[k] = this.target[k];
      }
    }
    return done;
  }

  applyClip() {
    if (this.mediaEl) {
      this.mediaEl.style.clipPath =
        `inset(${this.clip.t}% ${this.clip.r}% ${this.clip.b}% ${this.clip.l}%)`;
    }
  }

  tick() {
    const holdRange = HOLD_TIERS[this.index];

    switch (this.state) {
      case 'waiting':
        this.timer--;
        if (this.timer <= 0) {
          this.state = 'revealing';
          this.target = this.randomCrop();
        }
        break;

      case 'revealing':
        if (this.easeToTarget()) {
          this.state = 'holding';
          this.timer = holdRange[0] + Math.random() * (holdRange[1] - holdRange[0]);
        }
        break;

      case 'holding':
        this.timer--;
        if (this.timer <= 0) {
          if (this.morphs < this.maxMorphs && Math.random() < 0.6) {
            this.state = 'morphing';
            this.target = this.randomCrop();
            this.morphs++;
          } else {
            this.state = 'hiding';
            this.target = { t: 50, r: 50, b: 50, l: 50 };
          }
        }
        break;

      case 'morphing':
        if (this.easeToTarget()) {
          this.state = 'holding';
          this.timer = holdRange[0] * 0.5 + Math.random() * holdRange[0];
        }
        break;

      case 'hiding':
        if (this.easeToTarget()) {
          // Swap media, reposition, restart
          this.setRandomBounds();
          this.nextMedia();
          this.morphs = 0;
          this.maxMorphs = 1 + Math.floor(Math.random() * 3);
          this.clip = { t: 100, r: 100, b: 100, l: 100 };
          this.applyClip();
          this.state = 'waiting';
          this.timer = 20 + Math.random() * 40;
        }
        break;
    }

    this.applyClip();
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
  const stage = document.createElement('div');
  stage.className = 'layer-stage';

  const controllers = [];

  for (let i = 0; i < LAYER_COUNT; i++) {
    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.style.zIndex = i; // 0 = back (big), 17 = front (small)
    stage.appendChild(layer);
    controllers.push(new LayerController(layer, mediaList, i));
  }

  container.appendChild(stage);

  let rafId;
  function loop() {
    for (let i = 0; i < controllers.length; i++) controllers[i].tick();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      controllers.forEach(c => c.destroy());
      stage.remove();
    }
  };
}

export function destroyGridGallery(scene) {
  if (scene) scene.destroy();
}
