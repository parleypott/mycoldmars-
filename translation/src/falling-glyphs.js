// Falling-glyph ambient effect.
//
// Occasionally, characters from random scripts (Han, Hiragana, Hangul,
// Arabic, Hebrew, Greek, Cyrillic, Devanagari, Thai, Latin) fall from
// just above the viewport with gravity, bounce off a list of button
// rectangles, and exit at the bottom. ~7 in 10 seconds on average,
// organic / non-rhythmic spawning. Single canvas overlay, no DOM
// nodes per glyph, pointer-events: none so it never interferes with
// the actual UI underneath.

const SCRIPTS = [
  // Each entry: [start, end] inclusive Unicode ranges. Sampled uniformly.
  [0x4E00, 0x4FFF],   // CJK Unified (Han) — small slice
  [0x3041, 0x3096],   // Hiragana
  [0x30A1, 0x30F6],   // Katakana
  [0xAC00, 0xAC50],   // Hangul (slice)
  [0x0621, 0x064A],   // Arabic letters
  [0x05D0, 0x05EA],   // Hebrew letters
  [0x0391, 0x03A9],   // Greek capitals
  [0x03B1, 0x03C9],   // Greek lowercase
  [0x0410, 0x044F],   // Cyrillic letters
  [0x0905, 0x0939],   // Devanagari
  [0x0E01, 0x0E2E],   // Thai
  [0x10D0, 0x10F0],   // Georgian
  [0x0531, 0x0556],   // Armenian
];

function randomChar() {
  const range = SCRIPTS[(Math.random() * SCRIPTS.length) | 0];
  const cp = range[0] + ((Math.random() * (range[1] - range[0] + 1)) | 0);
  return String.fromCodePoint(cp);
}

const GRAVITY = 760;          // px/s^2
const AIR_DRAG = 0.998;       // per frame at 60fps
const RESTITUTION = 0.55;     // bounciness on collision
const ROT_DRAG = 0.99;
const SLEEP_VY = 95;          // |vy| below this on top-collision → start resting
const GROUND_FRICTION = 1.6;  // per second, horizontal velocity decay while resting
const FONT_PX = 22;
const FONT_FAMILY = "'Cormorant', 'Hiragino Sans', 'Noto Sans', system-ui, serif";

// Confetti palette — vibrant but on-brand. Each glyph picks one at spawn.
const PALETTE = [
  'rgba(221, 44, 30, 0.78)',   // np-red
  'rgba(82, 0, 4, 0.78)',      // np-burgundy
  'rgba(0, 76, 255, 0.74)',    // np-blue
  'rgba(13, 89, 33, 0.78)',    // np-green
  'rgba(180, 90, 0, 0.82)',    // burnt orange
  'rgba(196, 77, 142, 0.78)',  // magenta
  'rgba(0, 128, 138, 0.78)',   // teal
  'rgba(107, 45, 139, 0.78)',  // purple
  'rgba(218, 165, 32, 0.85)',  // gold
  'rgba(65, 44, 39, 0.7)',     // np-sepia (subtle base)
];

let canvas, ctx, raf, glyphs = [];
let getButtonRects = () => [];
let visible = false;
let lastT = 0;
let nextSpawnAt = 0;

export function initFallingGlyphs(opts = {}) {
  if (canvas) return;
  getButtonRects = opts.getButtonRects || (() => []);
  canvas = document.createElement('canvas');
  canvas.id = 'falling-glyphs';
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function startFallingGlyphs() {
  if (visible) return;
  visible = true;
  lastT = performance.now();
  scheduleNextSpawn(performance.now());
  if (!raf) raf = requestAnimationFrame(tick);
}

export function stopFallingGlyphs() {
  visible = false;
  glyphs = [];
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function scheduleNextSpawn(now) {
  // Exponential distribution: mean gap ~1500ms — produces a Poisson-ish
  // arrival pattern (organic, no rhythm). Each spawn may itself drop a
  // single glyph or a small cluster of 2–4.
  const meanMs = 1500;
  const gap = -Math.log(1 - Math.random()) * meanMs;
  nextSpawnAt = now + gap;
}

function spawnCluster() {
  const r = Math.random();
  let count = 1;
  if (r > 0.92) count = 3 + ((Math.random() * 2) | 0); // 3 or 4
  else if (r > 0.74) count = 2;
  for (let i = 0; i < count; i++) spawnGlyph(i, count);
}

function spawnGlyph(i, total) {
  const w = window.innerWidth;
  const x = Math.random() * w;
  // Already-moving entry (no ease-in): give it some downward velocity.
  const vy = 110 + Math.random() * 130;
  // Slight drift so cluster members spread.
  const vx = (Math.random() - 0.5) * 90 + (i - (total - 1) / 2) * 18;
  const angVel = (Math.random() - 0.5) * 1.4;
  glyphs.push({
    char: randomChar(),
    color: PALETTE[(Math.random() * PALETTE.length) | 0],
    x,
    y: -30 - Math.random() * 40,
    vx,
    vy,
    rot: (Math.random() - 0.5) * 0.6,
    angVel,
    size: FONT_PX + (Math.random() * 6 - 3),
    age: 0,
    restingOn: null,   // index into rects array, or null
    restingY: 0,       // the y coord we sit at while resting
  });
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - lastT) / 1000); // clamp at 50ms
  lastT = now;
  if (!visible) return;
  if (now >= nextSpawnAt) {
    spawnCluster();
    scheduleNextSpawn(now);
  }
  step(dt);
  draw();
}

function step(dt) {
  const rects = getButtonRects();
  const h = window.innerHeight;
  const w = window.innerWidth;

  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i];

    // Resting state: glyph sits on a button surface. Apply only ground
    // friction to vx, no gravity, no vy. When it slides off the edge
    // of its support, gravity takes over.
    if (g.restingOn !== null) {
      const support = rects[g.restingOn];
      // Check the support still exists and we're still on top of it.
      if (!support || g.x < support.left - 2 || g.x > support.right + 2) {
        g.restingOn = null;
        // Fall away cleanly.
      } else {
        // Slide with friction. Decay vx exponentially toward zero.
        const decay = Math.exp(-GROUND_FRICTION * dt);
        g.vx *= decay;
        g.angVel *= decay;
        g.x += g.vx * dt;
        g.y = support.top - 1;
        g.rot += g.angVel * dt;
        g.age += dt;
        // Sit forever? No — drift off after a long while so we don't
        // accumulate. Fade out via age cap below.
        if (g.age > 14) glyphs.splice(i, 1);
        continue;
      }
    }

    // Free flight.
    g.vy += GRAVITY * dt;
    g.vx *= Math.pow(AIR_DRAG, dt * 60);
    g.angVel *= Math.pow(ROT_DRAG, dt * 60);
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.rot += g.angVel * dt;
    g.age += dt;

    // Collide with each button rect (AABB, glyph as point).
    for (let ri = 0; ri < rects.length; ri++) {
      const r = rects[ri];
      if (g.x < r.left || g.x > r.right) continue;
      if (g.y < r.top || g.y > r.bottom) continue;

      const dTop    = Math.abs(g.y - r.top);
      const dBottom = Math.abs(g.y - r.bottom);
      const dLeft   = Math.abs(g.x - r.left);
      const dRight  = Math.abs(g.x - r.right);
      const m = Math.min(dTop, dBottom, dLeft, dRight);

      if (m === dTop) {
        // Top-hit: slow vy → start resting, fast vy → bounce.
        if (Math.abs(g.vy) < SLEEP_VY) {
          g.y = r.top - 1;
          g.vy = 0;
          g.angVel *= 0.5;
          g.restingOn = ri;
          break;
        }
        g.y = r.top - 1;
        g.vy = -Math.abs(g.vy) * RESTITUTION;
        g.vx += (Math.random() - 0.5) * 40;
        g.angVel += (Math.random() - 0.5) * 1.8;
      } else if (m === dBottom) {
        g.y = r.bottom + 1;
        g.vy = Math.abs(g.vy) * RESTITUTION;
      } else if (m === dLeft) {
        g.x = r.left - 1;
        g.vx = -Math.abs(g.vx) * RESTITUTION;
      } else {
        g.x = r.right + 1;
        g.vx = Math.abs(g.vx) * RESTITUTION;
      }
    }

    // Remove if off-screen or stuck for too long.
    if (g.y > h + 40 || g.x < -40 || g.x > w + 40 || g.age > 14) {
      glyphs.splice(i, 1);
    }
  }
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot);
    ctx.font = `${g.size}px ${FONT_FAMILY}`;
    ctx.fillStyle = g.color;
    ctx.fillText(g.char, 0, 0);
    ctx.restore();
  }
}
