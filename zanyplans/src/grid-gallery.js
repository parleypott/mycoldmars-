/**
 * Grid gallery — images in a grid with frames that grow, morph,
 * and shrink to reveal/hide media. Old media seamlessly swaps
 * out for new media from the pool.
 *
 * Each cell independently cycles through:
 *   hidden → reveal (clip grows) → hold → morph (clip reshapes) → hide → swap → repeat
 */

const COLS = 4;
const ROWS = 3;
const CELL_COUNT = COLS * ROWS;

// Easing speed — higher = faster animation
const EASE = 0.035;

// Timing in frames (~60fps)
const HOLD_MIN = 200;   // ~3.3s
const HOLD_MAX = 420;   // ~7s
const MORPH_HOLD = 150; // ~2.5s between morphs
const SWAP_PAUSE = 40;  // ~0.7s pause when hidden before new image
const MAX_MORPHS = 3;
const MORPH_CHANCE = 0.55;

// Ken Burns animation classes
const KB = ['kb-zoom-in', 'kb-zoom-out', 'kb-pan-left', 'kb-pan-right', 'kb-pan-up'];

class CellController {
  constructor(cellEl, pool, startDelay) {
    this.el = cellEl;
    this.pool = pool;
    this.idx = Math.floor(Math.random() * pool.length);
    this.mediaEl = null;

    // clip-path: inset(top% right% bottom% left%)
    this.clip = { t: 100, r: 100, b: 100, l: 100 };
    this.target = { t: 100, r: 100, b: 100, l: 100 };

    this.state = 'waiting';
    this.timer = startDelay;
    this.morphs = 0;
    this.speed = EASE * (0.6 + Math.random() * 0.8);

    this.loadMedia();
  }

  /** Generate a random crop — some sides open, some partially clipped */
  randomCrop() {
    const sides = ['t', 'r', 'b', 'l'];
    const crop = {};
    // 2–3 sides mostly open, the rest partially clipped for "weird framing"
    const openCount = 2 + Math.floor(Math.random() * 2);
    const order = [...sides].sort(() => Math.random() - 0.5);

    order.forEach((s, i) => {
      if (i < openCount) {
        crop[s] = Math.random() * 10; // nearly flush
      } else {
        crop[s] = 12 + Math.random() * 40; // 12–52% clipped
      }
    });
    return crop;
  }

  loadMedia() {
    const media = this.pool[this.idx];

    // Remove old element
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
      img.alt = media.label || '';
      this.mediaEl = img;
    } else {
      const d = document.createElement('div');
      d.style.cssText = `width:100%;height:100%;background:${media.color || '#1a1a2e'}`;
      this.mediaEl = d;
    }

    this.mediaEl.className = `gallery-media ${KB[Math.floor(Math.random() * KB.length)]}`;
    this.applyClip();
    this.el.appendChild(this.mediaEl);
  }

  nextMedia() {
    let next;
    do { next = Math.floor(Math.random() * this.pool.length); }
    while (next === this.idx && this.pool.length > 1);
    this.idx = next;
    this.loadMedia();
  }

  /** Ease clip values toward target. Returns true when close enough. */
  easeToTarget() {
    let done = true;
    for (const k of ['t', 'r', 'b', 'l']) {
      const diff = this.target[k] - this.clip[k];
      if (Math.abs(diff) > 0.3) {
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
      const { t, r, b, l } = this.clip;
      this.mediaEl.style.clipPath = `inset(${t}% ${r}% ${b}% ${l}%)`;
    }
  }

  tick() {
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
          this.timer = HOLD_MIN + Math.random() * (HOLD_MAX - HOLD_MIN);
        }
        break;

      case 'holding':
        this.timer--;
        if (this.timer <= 0) {
          if (this.morphs < MAX_MORPHS && Math.random() < MORPH_CHANCE) {
            this.state = 'morphing';
            this.target = this.randomCrop();
            this.morphs++;
          } else {
            this.state = 'hiding';
            // Random hide direction — collapse one or two sides
            const hide = { t: 100, r: 100, b: 100, l: 100 };
            // Sometimes collapse to one side for variety
            const dir = Math.random();
            if (dir < 0.25) { hide.b = 0; hide.l = 0; hide.r = 0; } // collapse upward
            else if (dir < 0.5) { hide.t = 0; hide.l = 0; hide.r = 0; } // collapse downward
            else if (dir < 0.75) { hide.t = 0; hide.b = 0; hide.r = 0; } // collapse leftward
            else { hide.t = 0; hide.b = 0; hide.l = 0; } // collapse rightward
            // Actually just close all sides to center
            this.target = { t: 50, r: 50, b: 50, l: 50 };
            // Or pick a random collapse
            if (Math.random() > 0.5) {
              this.target = hide;
            }
          }
        }
        break;

      case 'morphing':
        if (this.easeToTarget()) {
          this.state = 'holding';
          this.timer = MORPH_HOLD + Math.random() * MORPH_HOLD;
        }
        break;

      case 'hiding':
        if (this.easeToTarget()) {
          this.nextMedia();
          this.morphs = 0;
          this.clip = { t: 100, r: 100, b: 100, l: 100 };
          this.applyClip();
          this.state = 'waiting';
          this.timer = SWAP_PAUSE + Math.random() * SWAP_PAUSE;
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

/**
 * @param {Array} mediaList — full pool of media objects
 * @param {HTMLElement} container
 * @returns {{ destroy: Function }}
 */
export function createGridGallery(mediaList, container) {
  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  const controllers = [];

  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    grid.appendChild(cell);

    // Stagger so they don't all pop in at once
    const delay = Math.floor(i * 15 + Math.random() * 90);
    controllers.push(new CellController(cell, mediaList, delay));
  }

  container.appendChild(grid);

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
      grid.remove();
    }
  };
}

export function destroyGridGallery(scene) {
  if (scene) scene.destroy();
}
