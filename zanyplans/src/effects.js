let canvas = null;
let ctx = null;
let rafId = null;
let currentEffect = null;

const EFFECT_CSS_MAP = {
  'VHS MELT':       'fx-vhs',
  'CHROMATIC RIP':  'fx-chromatic',
  'KALEIDOVISION':  'fx-kaleidoscope',
  'DATAMOSH':       'fx-datamosh',
  'SCANLINES':      'fx-scanlines',
  'FUNHOUSE':       'fx-funhouse',
  'NEGATIVE':       'fx-negative',
  'THERMAL':        'fx-thermal',
  'DEEP FRY':       'fx-deepfry',
};

export function initEffects() {
  canvas = document.createElement('canvas');
  canvas.className = 'effects-canvas';
  resize();
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  return canvas;
}

function resize() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

export function applyEffect(name, container) {
  clearEffect(container);
  currentEffect = name;
  const cssClass = EFFECT_CSS_MAP[name];
  if (cssClass && container) {
    container.classList.add(cssClass);
  }
  startCanvasEffect(name);
}

export function clearEffect(container) {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); }
  if (container) {
    Object.values(EFFECT_CSS_MAP).forEach(cls => container.classList.remove(cls));
  }
  currentEffect = null;
}

export function destroyEffects() {
  if (rafId) cancelAnimationFrame(rafId);
  window.removeEventListener('resize', resize);
  if (canvas) canvas.remove();
  canvas = null;
  ctx = null;
  rafId = null;
  currentEffect = null;
}

// ═══════════════════════════════════════════
// Canvas overlay effects
// ═══════════════════════════════════════════

function startCanvasEffect(name) {
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  let t = 0;

  function loop() {
    t++;
    ctx.clearRect(0, 0, w, h);

    switch (name) {
      case 'VHS MELT':       drawVHS(t, w, h); break;
      case 'CHROMATIC RIP':  drawChromatic(t, w, h); break;
      case 'KALEIDOVISION':  drawKaleidoscope(t, w, h); break;
      case 'DATAMOSH':       drawDatamosh(t, w, h); break;
      case 'SCANLINES':      drawScanlines(t, w, h); break;
      case 'FUNHOUSE':       drawFunhouse(t, w, h); break;
      case 'NEGATIVE':       drawNegative(t, w, h); break;
      case 'THERMAL':        drawThermal(t, w, h); break;
      case 'DEEP FRY':       drawDeepFry(t, w, h); break;
    }

    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);
}

// ── VHS MELT ── (intensified)
function drawVHS(t, w, h) {
  const bandHeight = 3;
  const scroll = (t * 2) % (bandHeight * 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  for (let y = -bandHeight * 2 + scroll; y < h; y += bandHeight * 4) {
    ctx.fillRect(0, y, w, bandHeight * 2);
  }

  // More frequent glitch tears
  if (Math.random() < 0.12) {
    const tearY = Math.random() * h;
    const tearH = 2 + Math.random() * 15;
    const shift = (Math.random() - 0.5) * 100;
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,40,40' : '40,40,255'}, 0.25)`;
    ctx.fillRect(shift, tearY, w, tearH);
  }

  // Double tear
  if (Math.random() < 0.04) {
    const y1 = Math.random() * h;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(0, y1, w, 1);
    ctx.fillRect(0, y1 + 3, w, 1);
  }

  // Tracking noise
  const noiseY = h - 40 + Math.sin(t * 0.05) * 30;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  for (let x = 0; x < w; x += 2) {
    if (Math.random() > 0.4) {
      ctx.fillRect(x, noiseY + Math.random() * 30, 2, 1);
    }
  }

  drawVignette(w, h, 0.45);
}

// ── CHROMATIC RIP ── (intensified)
function drawChromatic(t, w, h) {
  const offset = Math.sin(t * 0.03) * 20;

  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  ctx.fillRect(-offset, 0, w, h);
  ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
  ctx.fillRect(offset, 0, w, h);
  ctx.fillStyle = 'rgba(0, 255, 0, 0.05)';
  ctx.fillRect(0, -offset * 0.5, w, h);

  // Thick edge fringes
  ctx.fillStyle = 'rgba(255, 0, 0, 0.18)';
  ctx.fillRect(0, 0, Math.abs(offset) + 8, h);
  ctx.fillStyle = 'rgba(0, 0, 255, 0.18)';
  ctx.fillRect(w - Math.abs(offset) - 8, 0, Math.abs(offset) + 8, h);

  // Horizontal scan pulse
  const pulseY = (t * 4) % h;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(0, pulseY, w, 3);

  // Random color flash
  if (Math.random() < 0.03) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,0,80' : '0,120,255'}, 0.08)`;
    ctx.fillRect(0, 0, w, h);
  }
}

// ── KALEIDOVISION ── (already good, keep as-is with minor boost)
function drawKaleidoscope(t, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const slices = 12;
  const rotation = t * 0.012;

  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.translate(cx, cy);

  for (let i = 0; i < slices; i++) {
    const angle = (i / slices) * Math.PI * 2 + rotation;
    const len = Math.max(w, h);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
    ctx.strokeStyle = `hsl(${(i * 360 / slices + t * 2.5) % 360}, 90%, 60%)`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const nextAngle = ((i + 1) / slices) * Math.PI * 2 + rotation;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
    ctx.lineTo(Math.cos(nextAngle) * len, Math.sin(nextAngle) * len);
    ctx.closePath();
    ctx.fillStyle = `hsla(${(i * 360 / slices + t * 2.5) % 360}, 80%, 50%, 0.04)`;
    ctx.fill();
  }

  ctx.restore();

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.4);
  grad.addColorStop(0, `hsla(${(t * 3) % 360}, 90%, 70%, 0.12)`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── DATAMOSH ── (intensified)
function drawDatamosh(t, w, h) {
  const blockSize = 12 + Math.sin(t * 0.05) * 6;

  if (t % 2 === 0) {
    const numBlocks = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < numBlocks; i++) {
      const bx = Math.floor(Math.random() * w / blockSize) * blockSize;
      const by = Math.floor(Math.random() * h / blockSize) * blockSize;
      const bw = blockSize * (1 + Math.floor(Math.random() * 5));
      const bh = blockSize * (1 + Math.floor(Math.random() * 3));
      const hue = Math.random() * 360;
      ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.18)`;
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  // Smear effect — horizontal displacement blocks
  if (Math.random() < 0.08) {
    const sy = Math.random() * h;
    const sh = 5 + Math.random() * 30;
    const sx = (Math.random() - 0.5) * 80;
    ctx.fillStyle = 'rgba(0,255,100,0.1)';
    ctx.fillRect(sx, sy, w, sh);
  }
}

// ── SCANLINES ── (intensified)
function drawScanlines(t, w, h) {
  const scroll = (t * 0.8) % 4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  for (let y = scroll; y < h; y += 4) {
    ctx.fillRect(0, y, w, 2);
  }

  ctx.fillStyle = 'rgba(0, 255, 100, 0.06)';
  ctx.fillRect(0, 0, w, h);

  if (Math.random() < 0.05) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, w, h);
  }

  drawVignette(w, h, 0.5);

  const beamY = (t * 2.5) % h;
  ctx.fillStyle = 'rgba(0, 255, 100, 0.07)';
  ctx.fillRect(0, beamY, w, 4);
}

// ── FUNHOUSE ── (intensified)
function drawFunhouse(t, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.1;

  for (let y = 0; y < h; y += 15) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < w; x += 8) {
      const wave = Math.sin((x + t * 3) * 0.02) * 20 + Math.sin((y + t * 1.5) * 0.01) * 15;
      ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle = `hsl(${(y + t * 1.5) % 360}, 60%, 60%)`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();

  const ccx = w / 2;
  const ccy = h / 2;
  const pulse = Math.sin(t * 0.025) * 0.5 + 0.5;
  const grad = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, 250 + pulse * 150);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  grad.addColorStop(0.5, 'rgba(255, 200, 100, 0.04)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── NEGATIVE ── (NEW — full inversion with jitter)
function drawNegative(t, w, h) {
  // Random inversion flash bands
  if (t % 8 < 4) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(0, 0, w, h);
  }

  // Horizontal banding
  const bandCount = 5 + Math.floor(Math.sin(t * 0.02) * 3);
  for (let i = 0; i < bandCount; i++) {
    const by = (h / bandCount) * i + Math.sin(t * 0.05 + i) * 20;
    const bh = h / bandCount * 0.3;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.02 + Math.sin(t * 0.03 + i * 0.5) * 0.02})`;
    ctx.fillRect(0, by, w, bh);
  }

  // Edge glow
  const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, 'rgba(200, 180, 255, 0.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── THERMAL ── (NEW — infrared heat map look)
function drawThermal(t, w, h) {
  // Sweeping heat bands
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const y = (h / bands) * i;
    const bh = h / bands;
    const heat = Math.sin(t * 0.02 + i * 0.8) * 0.5 + 0.5;
    const hue = heat * 60; // 0=red, 30=orange, 60=yellow
    ctx.fillStyle = `hsla(${hue}, 100%, 50%, ${0.03 + heat * 0.05})`;
    ctx.fillRect(0, y, w, bh);
  }

  // Hot spots
  for (let i = 0; i < 3; i++) {
    const hx = w * (0.2 + 0.3 * i) + Math.sin(t * 0.01 + i * 2) * 100;
    const hy = h * 0.5 + Math.cos(t * 0.015 + i * 3) * 150;
    const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, 120);
    grad.addColorStop(0, 'rgba(255, 255, 0, 0.08)');
    grad.addColorStop(0.5, 'rgba(255, 100, 0, 0.04)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Noise grid
  if (t % 3 === 0) {
    const gs = 20;
    for (let x = 0; x < w; x += gs) {
      for (let y = 0; y < h; y += gs) {
        if (Math.random() > 0.85) {
          const hue = Math.random() * 60;
          ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.06)`;
          ctx.fillRect(x, y, gs, gs);
        }
      }
    }
  }

  drawVignette(w, h, 0.35);
}

// ── DEEP FRY ── (NEW — extreme oversaturation + glow + noise)
function drawDeepFry(t, w, h) {
  // Pulsing color wash
  const hue = (t * 3) % 360;
  ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.04)`;
  ctx.fillRect(0, 0, w, h);

  // Bright spots that bloom
  for (let i = 0; i < 4; i++) {
    const bx = w * (0.15 + 0.7 * Math.sin(t * 0.008 + i * 1.5) * 0.5 + 0.5);
    const by = h * (0.15 + 0.7 * Math.cos(t * 0.01 + i * 2) * 0.5 + 0.5);
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, 200);
    grad.addColorStop(0, `hsla(${(hue + i * 90) % 360}, 100%, 80%, 0.1)`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // White flash
  if (Math.random() < 0.06) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fillRect(0, 0, w, h);
  }

  // JPEG artifact blocks
  if (t % 4 === 0) {
    for (let i = 0; i < 5; i++) {
      const bx = Math.random() * w;
      const by = Math.random() * h;
      ctx.fillStyle = `hsla(${Math.random() * 360}, 100%, 70%, 0.08)`;
      ctx.fillRect(bx, by, 20 + Math.random() * 60, 10 + Math.random() * 30);
    }
  }
}

// ── HELPERS ──
function drawVignette(w, h, intensity) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(w, h) * 0.7;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, `rgba(0, 0, 0, ${intensity})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}
