const SEGMENTS = [
  { color: '#00ffcc', effect: 'VHS MELT' },
  { color: '#ff3366', effect: 'CHROMATIC RIP' },
  { color: '#aa44ff', effect: 'KALEIDOVISION' },
  { color: '#44ff88', effect: 'DATAMOSH' },
  { color: '#ff8800', effect: 'SCANLINES' },
  { color: '#00aaff', effect: 'FUNHOUSE' },
  { color: '#ff00aa', effect: 'NEGATIVE' },
  { color: '#ffee00', effect: 'THERMAL' },
  { color: '#ff2200', effect: 'DEEP FRY' },
];

let wheelEl = null;
let svgEl = null;
let spinning = false;
let currentRotation = 0;
let glowHue = 0;
let glowRaf = null;

export function createWheel(onEffectSelected) {
  const container = document.createElement('div');
  container.className = 'wheel-container';
  wheelEl = container;

  const svg = buildWheelSVG();
  svgEl = svg;
  container.appendChild(svg);

  // Click handler
  container.addEventListener('click', () => {
    if (spinning) return;
    spinning = true;

    const extraRotations = 3 + Math.floor(Math.random() * 4);
    const segmentAngle = 360 / SEGMENTS.length;
    const randomSegment = Math.floor(Math.random() * SEGMENTS.length);
    const targetAngle = currentRotation + extraRotations * 360 + randomSegment * segmentAngle + segmentAngle / 2;

    currentRotation = targetAngle;
    svg.style.transform = `rotate(${targetAngle}deg)`;

    setTimeout(() => {
      spinning = false;
      const normalizedAngle = targetAngle % 360;
      const idx = Math.round(normalizedAngle / segmentAngle) % SEGMENTS.length;
      const selected = SEGMENTS[(SEGMENTS.length - idx) % SEGMENTS.length];
      onEffectSelected(selected.effect);
      try { playClickSound(); } catch(e) {}
    }, 2600);
  });

  // Ambient glow animation
  function animateGlow() {
    glowHue = (glowHue + 0.3) % 360;
    container.style.filter = `drop-shadow(0 0 8px hsla(${glowHue}, 100%, 60%, 0.5)) drop-shadow(0 0 20px hsla(${glowHue + 60}, 100%, 50%, 0.2))`;
    glowRaf = requestAnimationFrame(animateGlow);
  }
  glowRaf = requestAnimationFrame(animateGlow);

  return container;
}

function buildWheelSVG() {
  const size = 80;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const n = SEGMENTS.length;
  const angleStep = (2 * Math.PI) / n;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'wheel-svg');

  // Dark background circle
  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', cx);
  bg.setAttribute('cy', cy);
  bg.setAttribute('r', r);
  bg.setAttribute('fill', '#0a0a12');
  svg.appendChild(bg);

  // Neon arcs — no text
  SEGMENTS.forEach((seg, i) => {
    const startAngle = i * angleStep - Math.PI / 2;
    const endAngle = (i + 1) * angleStep - Math.PI / 2;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const largeArc = angleStep > Math.PI ? 1 : 0;

    // Filled wedge — very dark, just a hint of color
    const wedge = document.createElementNS(ns, 'path');
    wedge.setAttribute('d', `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`);
    wedge.setAttribute('fill', seg.color);
    wedge.setAttribute('fill-opacity', '0.15');
    wedge.setAttribute('stroke', seg.color);
    wedge.setAttribute('stroke-width', '0.3');
    wedge.setAttribute('stroke-opacity', '0.3');
    svg.appendChild(wedge);

    // Outer arc glow
    const arc = document.createElementNS(ns, 'path');
    const outerR = r - 1;
    const ax1 = cx + outerR * Math.cos(startAngle + 0.04);
    const ay1 = cy + outerR * Math.sin(startAngle + 0.04);
    const ax2 = cx + outerR * Math.cos(endAngle - 0.04);
    const ay2 = cy + outerR * Math.sin(endAngle - 0.04);
    arc.setAttribute('d', `M${ax1},${ay1} A${outerR},${outerR} 0 ${largeArc} 1 ${ax2},${ay2}`);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', seg.color);
    arc.setAttribute('stroke-width', '2.5');
    arc.setAttribute('stroke-opacity', '0.7');
    arc.setAttribute('stroke-linecap', 'round');
    svg.appendChild(arc);

    // Small dot at midpoint of arc
    const midAngle = startAngle + angleStep / 2;
    const dotR = r - 6;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', cx + dotR * Math.cos(midAngle));
    dot.setAttribute('cy', cy + dotR * Math.sin(midAngle));
    dot.setAttribute('r', '1.5');
    dot.setAttribute('fill', seg.color);
    dot.setAttribute('fill-opacity', '0.6');
    svg.appendChild(dot);
  });

  // Outer ring
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', cx);
  ring.setAttribute('cy', cy);
  ring.setAttribute('r', r);
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', 'rgba(255,255,255,0.15)');
  ring.setAttribute('stroke-width', '0.5');
  svg.appendChild(ring);

  // Inner ring
  const innerRing = document.createElementNS(ns, 'circle');
  innerRing.setAttribute('cx', cx);
  innerRing.setAttribute('cy', cy);
  innerRing.setAttribute('r', r * 0.3);
  innerRing.setAttribute('fill', '#0a0a12');
  innerRing.setAttribute('stroke', 'rgba(255,255,255,0.2)');
  innerRing.setAttribute('stroke-width', '0.5');
  svg.appendChild(innerRing);

  // Tiny center dot
  const center = document.createElementNS(ns, 'circle');
  center.setAttribute('cx', cx);
  center.setAttribute('cy', cy);
  center.setAttribute('r', '3');
  center.setAttribute('fill', 'rgba(255,255,255,0.3)');
  svg.appendChild(center);

  return svg;
}

function playClickSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

export function destroyWheel() {
  if (glowRaf) { cancelAnimationFrame(glowRaf); glowRaf = null; }
  if (wheelEl) { wheelEl.remove(); wheelEl = null; }
  svgEl = null;
  spinning = false;
  currentRotation = 0;
}
