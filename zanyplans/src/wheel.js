const SEGMENTS = [
  { color: '#e53e3e', label: 'VHS\nMELT',      effect: 'VHS MELT' },
  { color: '#dd6b20', label: 'CHROMATIC\nRIP',  effect: 'CHROMATIC RIP' },
  { color: '#d69e2e', label: 'KALEIDO\nVISION', effect: 'KALEIDOVISION' },
  { color: '#38a169', label: 'DATA\nMOSH',      effect: 'DATAMOSH' },
  { color: '#3182ce', label: 'SCAN\nLINES',     effect: 'SCANLINES' },
  { color: '#805ad5', label: 'FUN\nHOUSE',      effect: 'FUNHOUSE' },
  { color: '#e2e8f0', label: 'PIXEL\nSTORM',    effect: 'PIXELSTORM' },
];

let wheelEl = null;
let svgEl = null;
let labelEl = null;
let spinning = false;
let currentRotation = 0;

/**
 * Creates the wheel of fortune element.
 * @param {function} onEffectSelected - callback(effectName)
 * @returns {HTMLElement}
 */
export function createWheel(onEffectSelected) {
  const container = document.createElement('div');
  container.className = 'wheel-container';
  wheelEl = container;

  // Pointer
  const pointer = document.createElement('div');
  pointer.className = 'wheel-pointer';
  container.appendChild(pointer);

  // SVG Wheel
  const svg = buildWheelSVG();
  svgEl = svg;
  container.appendChild(svg);

  // Spin hint
  const hint = document.createElement('div');
  hint.className = 'wheel-spin-hint';
  hint.textContent = 'CLICK TO SPIN';
  container.appendChild(hint);

  // Label popup
  const label = document.createElement('div');
  label.className = 'wheel-label';
  labelEl = label;
  document.body.appendChild(label);

  // Click handler
  container.addEventListener('click', () => {
    if (spinning) return;
    spinning = true;
    hint.style.display = 'none';
    labelEl.classList.remove('show');

    // Random spin: 3–6 full rotations + random offset
    const extraRotations = 3 + Math.floor(Math.random() * 4);
    const segmentAngle = 360 / SEGMENTS.length;
    const randomSegment = Math.floor(Math.random() * SEGMENTS.length);
    const targetAngle = currentRotation + extraRotations * 360 + randomSegment * segmentAngle + segmentAngle / 2;

    currentRotation = targetAngle;
    svg.style.transform = `rotate(${targetAngle}deg)`;

    // After spin completes (~3s transition)
    setTimeout(() => {
      spinning = false;
      // Determine which segment is at top (pointer points down into wheel)
      const normalizedAngle = targetAngle % 360;
      // The pointer is at top (0°/360°). Segment 0 starts at 0°.
      // After rotation, the segment at top is determined by which arc faces up.
      const idx = Math.round(normalizedAngle / segmentAngle) % SEGMENTS.length;
      // Invert because rotation goes clockwise but segments are laid out clockwise
      const selected = SEGMENTS[(SEGMENTS.length - idx) % SEGMENTS.length];

      // Show label
      labelEl.innerHTML = `<span style="color:${selected.color}">${selected.effect}</span>`;
      labelEl.classList.add('show');

      onEffectSelected(selected.effect);

      // Synthesize click sound using Web Audio
      try { playClickSound(); } catch(e) {}
    }, 3100);
  });

  return container;
}

function buildWheelSVG() {
  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const n = SEGMENTS.length;
  const angleStep = (2 * Math.PI) / n;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'wheel-svg');

  // Outer ring
  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', cx);
  ring.setAttribute('cy', cy);
  ring.setAttribute('r', r + 3);
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', '#444');
  ring.setAttribute('stroke-width', '3');
  svg.appendChild(ring);

  SEGMENTS.forEach((seg, i) => {
    const startAngle = i * angleStep - Math.PI / 2;
    const endAngle = (i + 1) * angleStep - Math.PI / 2;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const largeArc = angleStep > Math.PI ? 1 : 0;

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`);
    path.setAttribute('fill', seg.color);
    path.setAttribute('stroke', '#222');
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);

    // Label
    const midAngle = startAngle + angleStep / 2;
    const labelR = r * 0.6;
    const lx = cx + labelR * Math.cos(midAngle);
    const ly = cy + labelR * Math.sin(midAngle);

    const lines = seg.label.split('\n');
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', lx);
    text.setAttribute('y', ly - (lines.length - 1) * 5);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', "'Press Start 2P', monospace");
    text.setAttribute('font-size', '6');
    text.setAttribute('fill', seg.color === '#e2e8f0' ? '#000' : '#fff');

    lines.forEach((line, j) => {
      const tspan = document.createElementNS(ns, 'tspan');
      tspan.setAttribute('x', lx);
      tspan.setAttribute('dy', j === 0 ? '0' : '10');
      tspan.textContent = line;
      text.appendChild(tspan);
    });

    svg.appendChild(text);
  });

  // Center dot
  const center = document.createElementNS(ns, 'circle');
  center.setAttribute('cx', cx);
  center.setAttribute('cy', cy);
  center.setAttribute('r', '12');
  center.setAttribute('fill', '#222');
  center.setAttribute('stroke', '#555');
  center.setAttribute('stroke-width', '2');
  svg.appendChild(center);

  return svg;
}

function playClickSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

export function destroyWheel() {
  if (wheelEl) { wheelEl.remove(); wheelEl = null; }
  if (labelEl) { labelEl.remove(); labelEl = null; }
  svgEl = null;
  spinning = false;
  currentRotation = 0;
}
