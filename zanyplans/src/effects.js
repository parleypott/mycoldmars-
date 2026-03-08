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
  'PIXELSTORM':     'fx-pixelstorm',
};

/**
 * Create the overlay canvas for additive effects.
 * @returns {HTMLCanvasElement}
 */
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

/**
 * Apply a named effect.
 */
export function applyEffect(name, container) {
  // Remove previous
  clearEffect(container);

  currentEffect = name;

  // Apply CSS class to windows container
  const cssClass = EFFECT_CSS_MAP[name];
  if (cssClass && container) {
    container.classList.add(cssClass);
  }

  // Start canvas overlay animation
  startCanvasEffect(name);
}

/**
 * Remove current effect.
 */
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
      case 'PIXELSTORM':     drawPixelstorm(t, w, h); break;
    }

    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);
}

// ── VHS MELT ──
// Scrolling scanlines + random glitch tears + CRT vignette
function drawVHS(t, w, h) {
  // Scrolling dark bands
  const bandHeight = 3;
  const scroll = (t * 1.5) % (bandHeight * 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = -bandHeight * 2 + scroll; y < h; y += bandHeight * 4) {
    ctx.fillRect(0, y, w, bandHeight * 2);
  }

  // Random horizontal glitch tear
  if (Math.random() < 0.06) {
    const tearY = Math.random() * h;
    const tearH = 2 + Math.random() * 8;
    const shift = (Math.random() - 0.5) * 60;
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '255,80,80' : '80,80,255'}, 0.15)`;
    ctx.fillRect(shift, tearY, w, tearH);
  }

  // Bottom tracking noise
  const noiseY = h - 30 + Math.sin(t * 0.05) * 20;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  for (let x = 0; x < w; x += 2) {
    if (Math.random() > 0.5) {
      ctx.fillRect(x, noiseY + Math.random() * 20, 2, 1);
    }
  }

  // CRT vignette
  drawVignette(w, h, 0.3);
}

// ── CHROMATIC RIP ──
// RGB fringe lines sweeping across
function drawChromatic(t, w, h) {
  const offset = Math.sin(t * 0.03) * 12;

  // Red fringe (left)
  ctx.fillStyle = 'rgba(255, 0, 0, 0.06)';
  ctx.fillRect(-offset, 0, w, h);

  // Blue fringe (right)
  ctx.fillStyle = 'rgba(0, 0, 255, 0.06)';
  ctx.fillRect(offset, 0, w, h);

  // Aberration lines at edges
  ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
  ctx.fillRect(0, 0, Math.abs(offset) + 3, h);
  ctx.fillStyle = 'rgba(0, 0, 255, 0.1)';
  ctx.fillRect(w - Math.abs(offset) - 3, 0, Math.abs(offset) + 3, h);

  // Horizontal scan pulse
  const pulseY = (t * 3) % h;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(0, pulseY, w, 2);
}

// ── KALEIDOVISION ──
// Radial mirror lines + prismatic color overlay
function drawKaleidoscope(t, w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const slices = 8;
  const rotation = t * 0.01;

  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.translate(cx, cy);

  for (let i = 0; i < slices; i++) {
    const angle = (i / slices) * Math.PI * 2 + rotation;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const len = Math.max(w, h);
    ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
    ctx.strokeStyle = `hsl(${(i * 360 / slices + t * 2) % 360}, 80%, 60%)`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Prismatic fills between lines
    const nextAngle = ((i + 1) / slices) * Math.PI * 2 + rotation;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
    ctx.lineTo(Math.cos(nextAngle) * len, Math.sin(nextAngle) * len);
    ctx.closePath();
    ctx.fillStyle = `hsla(${(i * 360 / slices + t * 2) % 360}, 70%, 50%, 0.03)`;
    ctx.fill();
  }

  ctx.restore();

  // Central glow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.4);
  grad.addColorStop(0, `hsla(${(t * 3) % 360}, 80%, 70%, 0.08)`);
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── DATAMOSH ──
// Random block artifacts + pixel noise
function drawDatamosh(t, w, h) {
  const blockSize = 16 + Math.sin(t * 0.05) * 8;

  // Random block displacement
  if (t % 3 === 0) {
    const numBlocks = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < numBlocks; i++) {
      const bx = Math.floor(Math.random() * w / blockSize) * blockSize;
      const by = Math.floor(Math.random() * h / blockSize) * blockSize;
      const bw = blockSize * (1 + Math.floor(Math.random() * 3));
      const bh = blockSize * (1 + Math.floor(Math.random() * 2));
      const hue = Math.random() * 360;
      ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.12)`;
      ctx.fillRect(bx, by, bw, bh);
    }
  }

  // Pixel noise
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4 * 8) {
    if (Math.random() > 0.97) {
      data[i] = Math.random() * 255;
      data[i + 1] = Math.random() * 255;
      data[i + 2] = Math.random() * 255;
      data[i + 3] = 20;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── SCANLINES ──
// Dense scanlines + phosphor glow + flicker
function drawScanlines(t, w, h) {
  // Scanlines
  const scroll = (t * 0.5) % 4;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  for (let y = scroll; y < h; y += 4) {
    ctx.fillRect(0, y, w, 2);
  }

  // Phosphor green tint
  ctx.fillStyle = 'rgba(0, 255, 100, 0.03)';
  ctx.fillRect(0, 0, w, h);

  // Random flicker
  if (Math.random() < 0.03) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, w, h);
  }

  // Vignette
  drawVignette(w, h, 0.4);

  // Scan beam
  const beamY = (t * 2) % h;
  ctx.fillStyle = 'rgba(0, 255, 100, 0.04)';
  ctx.fillRect(0, beamY, w, 3);
}

// ── FUNHOUSE ──
// Wavy distortion lines
function drawFunhouse(t, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.06;

  // Wavy horizontal lines
  for (let y = 0; y < h; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x < w; x += 10) {
      const wave = Math.sin((x + t * 2) * 0.02) * 15 + Math.sin((y + t) * 0.01) * 10;
      ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle = `hsl(${(y + t) % 360}, 50%, 60%)`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.restore();

  // Center fisheye glow
  const cx = w / 2;
  const cy = h / 2;
  const pulse = Math.sin(t * 0.02) * 0.5 + 0.5;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 200 + pulse * 100);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
  grad.addColorStop(0.5, 'rgba(255, 200, 100, 0.02)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

// ── PIXELSTORM ──
// Random noise + invert pulses + posterized color blocks
function drawPixelstorm(t, w, h) {
  // Color noise blocks
  const blockSize = 12;
  const numBlocks = 15;
  for (let i = 0; i < numBlocks; i++) {
    const bx = Math.random() * w;
    const by = Math.random() * h;
    const bw = blockSize + Math.random() * 40;
    const bh = blockSize + Math.random() * 30;
    const hue = (t * 10 + i * 50) % 360;
    ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.08)`;
    ctx.fillRect(bx, by, bw, bh);
  }

  // Invert flash
  if (Math.random() < 0.05) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(0, 0, w, h);
  }

  // Static noise overlay
  const imageData = ctx.createImageData(w / 4, h / 4);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.random() > 0.9) {
      const v = Math.random() * 255;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 15;
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // Draw small noise image scaled up
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w / 4;
  tempCanvas.height = h / 4;
  tempCanvas.getContext('2d').putImageData(imageData, 0, 0);
  ctx.drawImage(tempCanvas, 0, 0, w, h);
  ctx.restore();
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
