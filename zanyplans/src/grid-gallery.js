/**
 * Layered gallery — tall scrolling canvas (3x viewport height).
 * Auto-scrolls down one page, then back up, repeating forever.
 * Layers are spread across the full height, stacked by depth.
 * More layers, more gridded, every inch covered.
 */

const LAYER_COUNT = 36;
const PAGE_HEIGHT = 300; // % of viewport (3 pages tall)
const SCROLL_SPEED = 0.35; // pixels per frame
const KB = ['kb-zoom-in', 'kb-zoom-out', 'kb-pan-left', 'kb-pan-right', 'kb-pan-up'];

// Size ranges: [minW%, maxW%, minH(vh), maxH(vh)]
// Heights in vh so they scale with viewport, not the tall container
function sizeForIndex(i) {
  if (i < 8) {
    // Back: huge
    return {
      w: [60 + Math.random() * 40, 0], // 60–100% width
      hVh: 50 + Math.random() * 55,    // 50–105vh
    };
  } else if (i < 20) {
    // Mid: medium
    return {
      w: [25 + Math.random() * 45, 0], // 25–70%
      hVh: 25 + Math.random() * 45,    // 25–70vh
    };
  } else {
    // Front: smaller
    return {
      w: [12 + Math.random() * 30, 0], // 12–42%
      hVh: 12 + Math.random() * 30,    // 12–42vh
    };
  }
}

function speedForIndex(i) {
  if (i < 8) return 0.015 + Math.random() * 0.012;
  if (i < 20) return 0.025 + Math.random() * 0.02;
  return 0.04 + Math.random() * 0.025;
}

function holdForIndex(i) {
  if (i < 8) return [350, 700];
  if (i < 20) return [180, 400];
  return [80, 240];
}

class LayerController {
  constructor(el, pool, index, stageHeightVh) {
    this.el = el;
    this.pool = pool;
    this.index = index;
    this.stageHeightVh = stageHeightVh;
    this.mediaIdx = Math.floor(Math.random() * pool.length);
    this.mediaEl = null;
    this.speed = speedForIndex(index) * (0.6 + Math.random() * 0.8);

    this.clip = { t: 100, r: 100, b: 100, l: 100 };
    this.target = { t: 100, r: 100, b: 100, l: 100 };

    this.state = 'waiting';
    this.timer = index * 5 + Math.floor(Math.random() * 80);
    this.morphs = 0;
    this.maxMorphs = 1 + Math.floor(Math.random() * 3);

    this.setRandomBounds();
    this.loadMedia();
  }

  setRandomBounds() {
    const size = sizeForIndex(this.index);
    const w = size.w[0];
    const hVh = size.hVh;
    // Convert vh height to % of stage height
    const hPct = (hVh / this.stageHeightVh) * 100;
    const x = -5 + Math.random() * (105 - w);
    const y = Math.random() * (100 - hPct);

    this.el.style.left = x + '%';
    this.el.style.top = y + '%';
    this.el.style.width = w + '%';
    this.el.style.height = hPct + '%';
  }

  randomCrop() {
    const style = Math.random();
    if (style < 0.35) {
      return {
        t: Math.random() * 6, r: Math.random() * 6,
        b: Math.random() * 6, l: Math.random() * 6,
      };
    } else if (style < 0.55) {
      const s = 12 + Math.random() * 30;
      return {
        t: s * Math.random(), r: Math.random() * 8,
        b: s * (1 - Math.random()), l: Math.random() * 8,
      };
    } else if (style < 0.75) {
      const s = 12 + Math.random() * 30;
      return {
        t: Math.random() * 8, r: s * Math.random(),
        b: Math.random() * 8, l: s * (1 - Math.random()),
      };
    } else {
      const sides = ['t', 'r', 'b', 'l'];
      const crop = {};
      const heavy = Math.floor(Math.random() * 4);
      sides.forEach((s, i) => {
        crop[s] = i === heavy ? (18 + Math.random() * 40) : (Math.random() * 10);
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
    const holdRange = holdForIndex(this.index);

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
          this.setRandomBounds();
          this.nextMedia();
          this.morphs = 0;
          this.maxMorphs = 1 + Math.floor(Math.random() * 3);
          this.clip = { t: 100, r: 100, b: 100, l: 100 };
          this.applyClip();
          this.state = 'waiting';
          this.timer = 15 + Math.random() * 35;
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
  // Scrolling wrapper
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

  // Auto-scroll state
  let scrollPos = 0;
  let scrollDir = 1; // 1 = down, -1 = up
  const maxScroll = () => scroller.scrollHeight - scroller.clientHeight;

  let rafId;
  function loop() {
    // Tick all layer animations
    for (let i = 0; i < controllers.length; i++) controllers[i].tick();

    // Auto-scroll
    const max = maxScroll();
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
