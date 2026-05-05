import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';
import './style.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ─── Element refs ───
const canvas = document.getElementById('canvas');
const shapesLayer = document.getElementById('shapes-layer');
const overlayLayer = document.getElementById('overlay-layer');
const gridRect = document.getElementById('grid');
const stage = document.getElementById('stage');
const inspector = document.getElementById('inspector');

// ─── State ───
const PALETTE = ['#FF2E63', '#FFD93D', '#00D4FF', '#00F5A0', '#BC52FF', '#FF7A00', '#1A1A1A'];

const state = {
  shapes: [],         // array of shape objects
  selectedId: null,
  nextShapeId: 1,
  activeTool: 'select',
  activeColor: PALETTE[0],
  keyframes: [],
  selectedKfId: null,
  nextKfId: 1,
  playing: false,
  playStart: 0,
  playOffset: 0,
  rafId: null,
  // viewBox for SVG coordinate space (1:1 with stage pixels)
  vw: 800,
  vh: 600,
};

// ─── Storage ───
const LS_KEY = 'animatedcrazy_v1';

function saveState() {
  if (state.playing) return;
  try {
    const data = {
      shapes: state.shapes,
      keyframes: state.keyframes,
      activeColor: state.activeColor,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) { /* quota — ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.shapes)) {
      state.shapes = d.shapes;
      // ensure nextShapeId beyond any loaded
      const maxId = state.shapes.reduce((m, s) => {
        const n = parseInt(String(s.id).replace(/\D/g, ''), 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      state.nextShapeId = maxId + 1;
    }
    if (Array.isArray(d.keyframes)) {
      state.keyframes = d.keyframes;
      const maxK = state.keyframes.reduce((m, k) => {
        const n = parseInt(String(k.id).replace(/\D/g, ''), 10);
        return isNaN(n) ? m : Math.max(m, n);
      }, 0);
      state.nextKfId = maxK + 1;
    }
    if (typeof d.activeColor === 'string') state.activeColor = d.activeColor;
  } catch (e) { console.warn('[ac] load failed', e); }
}
loadState();

// ─── Coordinate helpers ───
function eventToSvgPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * state.vw,
    y: ((e.clientY - rect.top) / rect.height) * state.vh,
  };
}

function svgToScreenPoint(x, y) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + (x / state.vw) * rect.width,
    y: rect.top + (y / state.vh) * rect.height,
  };
}

function resizeViewBox() {
  const r = stage.getBoundingClientRect();
  state.vw = Math.max(100, Math.round(r.width));
  state.vh = Math.max(100, Math.round(r.height));
  canvas.setAttribute('viewBox', `0 0 ${state.vw} ${state.vh}`);
  gridRect.setAttribute('width', state.vw);
  gridRect.setAttribute('height', state.vh);
}
window.addEventListener('resize', () => {
  resizeViewBox();
  if (state.selectedId) positionInspector();
});
resizeViewBox();

// ─── Shape factory ───
function makeShape(type, x, y, w, h) {
  const id = 's' + (state.nextShapeId++);
  const base = {
    id, type,
    x, y,
    width: Math.max(2, w),
    height: Math.max(2, h),
    rotation: 0,
    color: state.activeColor,
    opacity: 1,
  };
  if (type === 'star') base.points = 5;
  if (type === 'squiggly') {
    base.points = [];        // unit-space [-0.5..0.5]
    base.drawOn = 1;
    base.strokeWidth = 6;
    base.color = state.activeColor;
  }
  return base;
}

// Reasonable default size for click-drop shapes
function defaultSize(type) {
  if (type === 'star') return [120, 120];
  if (type === 'circle') return [120, 120];
  if (type === 'triangle') return [120, 110];
  return [140, 90]; // rect / squiggly fallback
}

// ─── SVG rendering ───
function shapeToSvgEl(s, opts = {}) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('shape', 'shape-' + s.type);
  g.dataset.id = s.id;
  g.setAttribute('transform', `translate(${s.x} ${s.y}) rotate(${s.rotation})`);
  g.style.opacity = s.opacity;

  if (s.type === 'rect') {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', -s.width / 2);
    r.setAttribute('y', -s.height / 2);
    r.setAttribute('width', s.width);
    r.setAttribute('height', s.height);
    r.setAttribute('fill', s.color);
    r.setAttribute('stroke', '#1a1a1a');
    r.setAttribute('stroke-width', 3);
    g.appendChild(r);
  } else if (s.type === 'circle') {
    const e = document.createElementNS(SVG_NS, 'ellipse');
    e.setAttribute('cx', 0);
    e.setAttribute('cy', 0);
    e.setAttribute('rx', s.width / 2);
    e.setAttribute('ry', s.height / 2);
    e.setAttribute('fill', s.color);
    e.setAttribute('stroke', '#1a1a1a');
    e.setAttribute('stroke-width', 3);
    g.appendChild(e);
  } else if (s.type === 'triangle') {
    const p = document.createElementNS(SVG_NS, 'polygon');
    const w = s.width / 2, h = s.height / 2;
    p.setAttribute('points', `0,${-h} ${w},${h} ${-w},${h}`);
    p.setAttribute('fill', s.color);
    p.setAttribute('stroke', '#1a1a1a');
    p.setAttribute('stroke-width', 3);
    p.setAttribute('stroke-linejoin', 'round');
    g.appendChild(p);
  } else if (s.type === 'star') {
    const p = document.createElementNS(SVG_NS, 'polygon');
    p.setAttribute('points', starPoints(s.points || 5, s.width / 2, s.height / 2));
    p.setAttribute('fill', s.color);
    p.setAttribute('stroke', '#1a1a1a');
    p.setAttribute('stroke-width', 3);
    p.setAttribute('stroke-linejoin', 'round');
    g.appendChild(p);
  } else if (s.type === 'squiggly') {
    // hit path (transparent, wider) for selection
    const hit = document.createElementNS(SVG_NS, 'path');
    hit.setAttribute('d', squigglePathD(s));
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', Math.max(22, (s.strokeWidth || 6) + 16));
    hit.setAttribute('stroke-linecap', 'round');
    hit.setAttribute('stroke-linejoin', 'round');
    hit.setAttribute('pointer-events', 'stroke');
    g.appendChild(hit);

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', squigglePathD(s));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', s.color);
    path.setAttribute('stroke-width', s.strokeWidth || 6);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('pathLength', '1');
    const drawOn = clamp(s.drawOn ?? 1, 0, 1);
    path.setAttribute('stroke-dasharray', '1 1');
    path.setAttribute('stroke-dashoffset', String(1 - drawOn));
    g.appendChild(path);
  }

  if (opts.selectable !== false) {
    g.addEventListener('mousedown', e => onShapeMouseDown(e, s.id));
  }
  return g;
}

function starPoints(numPoints, rxOuter, ryOuter) {
  // numPoints used as "spokes" — outer/inner alternating
  const n = Math.max(3, Math.min(12, numPoints));
  const inner = 0.42;
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : inner;
    const x = Math.cos(a) * rxOuter * r;
    const y = Math.sin(a) * ryOuter * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

// Build a smooth path string from squiggly's unit-space points.
function squigglePathD(s) {
  const pts = (s.points || []).map(([ux, uy]) => [ux * s.width, uy * s.height]);
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  // Catmull-Rom-ish smoothing
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

function renderShapes() {
  shapesLayer.innerHTML = '';
  for (const s of state.shapes) {
    const el = shapeToSvgEl(s);
    if (s.id === state.selectedId) {
      el.classList.add('selected');
      // Selection frame on top of shape
      const frame = document.createElementNS(SVG_NS, 'rect');
      frame.setAttribute('class', 'selection-frame');
      frame.setAttribute('x', -s.width / 2 - 4);
      frame.setAttribute('y', -s.height / 2 - 4);
      frame.setAttribute('width', s.width + 8);
      frame.setAttribute('height', s.height + 8);
      frame.setAttribute('fill', 'none');
      frame.setAttribute('stroke', '#1a1a1a');
      frame.setAttribute('stroke-width', 2);
      frame.setAttribute('stroke-dasharray', '6 4');
      frame.setAttribute('pointer-events', 'none');
      el.appendChild(frame);
    }
    shapesLayer.appendChild(el);
  }
}

// ─── Tool selection ───
function setActiveTool(tool) {
  state.activeTool = tool;
  document.querySelectorAll('.tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  canvas.classList.toggle('tool-select', tool === 'select');
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  if (tool !== 'select') {
    state.selectedId = null;
    inspector.classList.add('hidden');
    renderShapes();
    renderShapesPanel();
  }
}

document.querySelectorAll('.tool').forEach(b => {
  b.addEventListener('click', () => setActiveTool(b.dataset.tool));
});

// ─── Palette ───
document.querySelectorAll('#palette .swatch').forEach(b => {
  b.addEventListener('click', () => {
    state.activeColor = b.dataset.color;
    saveState();
  });
});

// ─── Canvas interactions ───
let drag = null;

canvas.addEventListener('mousedown', e => {
  if (e.target.closest('#inspector')) return;
  const pt = eventToSvgPoint(e);

  // Shape hit?
  const hitEl = e.target.closest('.shape');
  if (hitEl && state.activeTool === 'select') {
    // handled by onShapeMouseDown via element listener — bail here
    return;
  }

  // Empty canvas click in select mode → deselect
  if (state.activeTool === 'select') {
    if (state.selectedId) {
      state.selectedId = null;
      inspector.classList.add('hidden');
      renderShapes();
      renderShapesPanel();
    }
    return;
  }

  // Drawing tools — start a new shape
  e.preventDefault();
  if (state.activeTool === 'squiggly') {
    drag = {
      mode: 'draw-squiggly',
      raw: [[pt.x, pt.y]],
    };
    // Visual preview
    overlayLayer.innerHTML = '';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'preview-path');
    path.setAttribute('stroke', state.activeColor);
    path.setAttribute('d', `M ${pt.x} ${pt.y}`);
    overlayLayer.appendChild(path);
    drag.previewEl = path;
  } else {
    drag = {
      mode: 'draw-rect',
      type: state.activeTool,
      sx: pt.x,
      sy: pt.y,
      cx: pt.x,
      cy: pt.y,
    };
    overlayLayer.innerHTML = '';
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('class', 'preview-path');
    r.setAttribute('fill', state.activeColor);
    r.setAttribute('fill-opacity', '0.35');
    r.setAttribute('x', pt.x);
    r.setAttribute('y', pt.y);
    r.setAttribute('width', 0);
    r.setAttribute('height', 0);
    overlayLayer.appendChild(r);
    drag.previewEl = r;
  }
});

window.addEventListener('mousemove', e => {
  if (!drag) {
    if (window._shapeDrag) handleShapeDragMove(e);
    return;
  }
  const pt = eventToSvgPoint(e);

  if (drag.mode === 'draw-squiggly') {
    const last = drag.raw[drag.raw.length - 1];
    if (Math.hypot(pt.x - last[0], pt.y - last[1]) > 2.5) {
      drag.raw.push([pt.x, pt.y]);
      const d = drag.raw.map((p, i) => (i === 0 ? `M ${p[0]} ${p[1]}` : `L ${p[0]} ${p[1]}`)).join(' ');
      drag.previewEl.setAttribute('d', d);
    }
  } else if (drag.mode === 'draw-rect') {
    drag.cx = pt.x;
    drag.cy = pt.y;
    const x = Math.min(drag.sx, drag.cx);
    const y = Math.min(drag.sy, drag.cy);
    const w = Math.abs(drag.cx - drag.sx);
    const h = Math.abs(drag.cy - drag.sy);
    drag.previewEl.setAttribute('x', x);
    drag.previewEl.setAttribute('y', y);
    drag.previewEl.setAttribute('width', w);
    drag.previewEl.setAttribute('height', h);
  }
});

window.addEventListener('mouseup', () => {
  if (window._shapeDrag) {
    window._shapeDrag = null;
    saveState();
  }
  if (!drag) return;

  if (drag.mode === 'draw-squiggly') {
    overlayLayer.innerHTML = '';
    if (drag.raw.length < 2) { drag = null; return; }
    finalizeSquiggly(drag.raw);
  } else if (drag.mode === 'draw-rect') {
    overlayLayer.innerHTML = '';
    let w = Math.abs(drag.cx - drag.sx);
    let h = Math.abs(drag.cy - drag.sy);
    let cx, cy;
    if (w < 8 && h < 8) {
      // Treat as click-place at default size
      [w, h] = defaultSize(drag.type);
      cx = drag.sx;
      cy = drag.sy;
    } else {
      cx = (drag.sx + drag.cx) / 2;
      cy = (drag.sy + drag.cy) / 2;
    }
    const s = makeShape(drag.type, cx, cy, w, h);
    state.shapes.push(s);
    state.selectedId = s.id;
    setActiveTool('select');
    renderShapes();
    renderShapesPanel();
    showInspector();
    saveState();
  }
  drag = null;
});

function finalizeSquiggly(raw) {
  // bbox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // Pad bbox a bit so a horizontal line still has a height etc.
  const pad = 6;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = Math.max(8, maxX - minX);
  const h = Math.max(8, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Convert to unit-space relative to bbox center
  const points = raw.map(([x, y]) => [(x - cx) / w, (y - cy) / h]);
  const s = makeShape('squiggly', cx, cy, w, h);
  s.points = points;
  state.shapes.push(s);
  state.selectedId = s.id;
  setActiveTool('select');
  renderShapes();
  renderShapesPanel();
  showInspector();
  saveState();
}

// ─── Shape drag (move) in select mode ───
function onShapeMouseDown(e, id) {
  if (state.activeTool !== 'select') return;
  e.stopPropagation();
  const s = state.shapes.find(x => x.id === id);
  if (!s) return;
  state.selectedId = id;
  const pt = eventToSvgPoint(e);
  window._shapeDrag = {
    id,
    offX: pt.x - s.x,
    offY: pt.y - s.y,
    moved: false,
  };
  renderShapes();
  renderShapesPanel();
  showInspector();
}

function handleShapeDragMove(e) {
  const d = window._shapeDrag;
  if (!d) return;
  const s = state.shapes.find(x => x.id === d.id);
  if (!s) return;
  const pt = eventToSvgPoint(e);
  s.x = pt.x - d.offX;
  s.y = pt.y - d.offY;
  d.moved = true;
  // Cheap update: reposition single el
  const el = shapesLayer.querySelector(`[data-id="${d.id}"]`);
  if (el) el.setAttribute('transform', `translate(${s.x} ${s.y}) rotate(${s.rotation})`);
  positionInspector();
  syncInspectorValues();
}

// ─── Inspector ───
const insType = document.getElementById('ins-type');
const insClose = document.getElementById('ins-close');
const insX = document.getElementById('ins-x');
const insY = document.getElementById('ins-y');
const insW = document.getElementById('ins-w');
const insH = document.getElementById('ins-h');
const insRot = document.getElementById('ins-rot');
const insRotVal = document.getElementById('ins-rot-val');
const insOpacity = document.getElementById('ins-opacity');
const insOpacityVal = document.getElementById('ins-opacity-val');
const insSquiggly = document.getElementById('ins-squiggly');
const insDrawOn = document.getElementById('ins-drawon');
const insDrawOnVal = document.getElementById('ins-drawon-val');
const insStroke = document.getElementById('ins-stroke');
const insStrokeVal = document.getElementById('ins-stroke-val');
const insStar = document.getElementById('ins-star');
const insPoints = document.getElementById('ins-points');
const insPointsVal = document.getElementById('ins-points-val');
const insColor = document.getElementById('ins-color');
const insDup = document.getElementById('ins-dup');
const insDel = document.getElementById('ins-del');

function selectedShape() {
  return state.shapes.find(s => s.id === state.selectedId) || null;
}

function showInspector() {
  const s = selectedShape();
  if (!s) { inspector.classList.add('hidden'); return; }
  inspector.classList.remove('hidden');
  insType.textContent = s.type.toUpperCase();
  insSquiggly.classList.toggle('hidden', s.type !== 'squiggly');
  insStar.classList.toggle('hidden', s.type !== 'star');
  syncInspectorValues();
  positionInspector();
}

function positionInspector() {
  const s = selectedShape();
  if (!s) return;
  // Place inspector to the right of the shape's bounding box, on screen.
  const screen = svgToScreenPoint(s.x + s.width / 2, s.y - s.height / 2);
  let left = screen.x + 14;
  let top = screen.y;
  // Clamp to viewport
  const insW_ = 240;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (left + insW_ > vw - 12) {
    // try left side
    const screenLeft = svgToScreenPoint(s.x - s.width / 2, s.y - s.height / 2);
    left = Math.max(12, screenLeft.x - insW_ - 14);
  }
  top = Math.max(12, Math.min(top, vh - 360));
  inspector.style.left = left + 'px';
  inspector.style.top = top + 'px';
}

function syncInspectorValues() {
  const s = selectedShape();
  if (!s) return;
  insX.value = Math.round(s.x);
  insY.value = Math.round(s.y);
  insW.value = Math.round(s.width);
  insH.value = Math.round(s.height);
  insRot.value = s.rotation;
  insRotVal.textContent = Math.round(s.rotation) + '°';
  insOpacity.value = Math.round(s.opacity * 100);
  insOpacityVal.textContent = Math.round(s.opacity * 100) + '%';
  insColor.value = s.color || '#FF2E63';
  if (s.type === 'squiggly') {
    insDrawOn.value = Math.round((s.drawOn ?? 1) * 100);
    insDrawOnVal.textContent = Math.round((s.drawOn ?? 1) * 100) + '%';
    insStroke.value = s.strokeWidth || 6;
    insStrokeVal.textContent = (s.strokeWidth || 6);
  }
  if (s.type === 'star') {
    insPoints.value = s.points || 5;
    insPointsVal.textContent = (s.points || 5);
  }
}

function updateSelectedShape(fn) {
  const s = selectedShape();
  if (!s) return;
  fn(s);
  renderShapes();
  renderShapesPanel();
  positionInspector();
  saveState();
}

insClose.addEventListener('click', () => {
  state.selectedId = null;
  inspector.classList.add('hidden');
  renderShapes();
  renderShapesPanel();
});

insX.addEventListener('input', e => updateSelectedShape(s => { s.x = parseFloat(e.target.value) || 0; }));
insY.addEventListener('input', e => updateSelectedShape(s => { s.y = parseFloat(e.target.value) || 0; }));
insW.addEventListener('input', e => updateSelectedShape(s => { s.width = Math.max(2, parseFloat(e.target.value) || 2); }));
insH.addEventListener('input', e => updateSelectedShape(s => { s.height = Math.max(2, parseFloat(e.target.value) || 2); }));
insRot.addEventListener('input', e => {
  const v = parseFloat(e.target.value) || 0;
  insRotVal.textContent = Math.round(v) + '°';
  updateSelectedShape(s => { s.rotation = v; });
});
insOpacity.addEventListener('input', e => {
  const v = parseFloat(e.target.value) / 100;
  insOpacityVal.textContent = Math.round(v * 100) + '%';
  updateSelectedShape(s => { s.opacity = v; });
});
insColor.addEventListener('input', e => updateSelectedShape(s => { s.color = e.target.value; }));
document.querySelectorAll('.ins-sw').forEach(b => {
  b.addEventListener('click', () => {
    const c = b.dataset.c;
    insColor.value = c;
    updateSelectedShape(s => { s.color = c; });
  });
});

insDrawOn.addEventListener('input', e => {
  const v = parseFloat(e.target.value) / 100;
  insDrawOnVal.textContent = Math.round(v * 100) + '%';
  updateSelectedShape(s => { s.drawOn = v; });
});
insStroke.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  insStrokeVal.textContent = v;
  updateSelectedShape(s => { s.strokeWidth = v; });
});
insPoints.addEventListener('input', e => {
  const v = parseInt(e.target.value, 10);
  insPointsVal.textContent = v;
  updateSelectedShape(s => { s.points = v; });
});

insDup.addEventListener('click', () => {
  const s = selectedShape();
  if (!s) return;
  const copy = JSON.parse(JSON.stringify(s));
  copy.id = 's' + (state.nextShapeId++);
  copy.x += 24;
  copy.y += 24;
  state.shapes.push(copy);
  state.selectedId = copy.id;
  renderShapes();
  renderShapesPanel();
  showInspector();
  saveState();
});

insDel.addEventListener('click', () => {
  const s = selectedShape();
  if (!s) return;
  state.shapes = state.shapes.filter(x => x.id !== s.id);
  // Also remove from any keyframe entries
  for (const kf of state.keyframes) delete kf.shapes[s.id];
  state.selectedId = null;
  inspector.classList.add('hidden');
  renderShapes();
  renderShapesPanel();
  saveState();
});

// ─── Shapes panel ───
const shapesList = document.getElementById('shapes-list');
const shapesCount = document.getElementById('shapes-count');

function renderShapesPanel() {
  shapesList.innerHTML = '';
  shapesCount.textContent = state.shapes.length;
  if (state.shapes.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'shapes-empty';
    empty.innerHTML = 'No shapes yet.<br>Pick a tool above and<br>draw on the canvas.';
    shapesList.appendChild(empty);
    return;
  }
  state.shapes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'shape-row' + (s.id === state.selectedId ? ' active' : '');
    const icon = document.createElement('div');
    icon.className = 'shape-icon';
    icon.style.background = s.type === 'squiggly' ? '#fff' : s.color;
    if (s.type === 'squiggly') {
      icon.innerHTML = `<svg viewBox="0 0 20 20" width="16" height="16"><path d="M2 14 Q 5 8, 8 12 T 14 11 T 18 6" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
    }
    row.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'shape-name';
    name.textContent = `${s.type.toUpperCase()} ${String(i + 1).padStart(2, '0')}`;
    row.appendChild(name);

    const del = document.createElement('button');
    del.className = 'shape-row-btn';
    del.title = 'Delete';
    del.textContent = '×';
    del.addEventListener('click', e => {
      e.stopPropagation();
      state.shapes = state.shapes.filter(x => x.id !== s.id);
      for (const kf of state.keyframes) delete kf.shapes[s.id];
      if (state.selectedId === s.id) {
        state.selectedId = null;
        inspector.classList.add('hidden');
      }
      renderShapes();
      renderShapesPanel();
      saveState();
    });
    row.appendChild(del);

    row.addEventListener('click', () => {
      state.selectedId = s.id;
      setActiveTool('select');
      renderShapes();
      renderShapesPanel();
      showInspector();
    });

    shapesList.appendChild(row);
  });
}

// ─── Keyframes ───
function snapshotShapes() {
  const out = {};
  for (const s of state.shapes) {
    out[s.id] = {
      x: s.x, y: s.y,
      width: s.width, height: s.height,
      rotation: s.rotation,
      color: s.color,
      opacity: s.opacity,
      drawOn: s.drawOn ?? 1,
      strokeWidth: s.strokeWidth ?? null,
      points: s.points ?? null,
    };
  }
  return out;
}

function addKeyframe() {
  const kf = {
    id: 'k' + (state.nextKfId++),
    shapes: snapshotShapes(),
    duration: 2.0,
    easing: 'easeInOut',
  };
  state.keyframes.push(kf);
  state.selectedKfId = kf.id;
  renderKeyframes();
  renderEditor();
  saveState();
}

function deleteKeyframe(id) {
  state.keyframes = state.keyframes.filter(k => k.id !== id);
  if (state.selectedKfId === id) {
    state.selectedKfId = state.keyframes[0]?.id ?? null;
  }
  renderKeyframes();
  renderEditor();
  saveState();
}

function totalDuration() {
  if (state.keyframes.length < 2) return 0;
  let t = 0;
  for (let i = 0; i < state.keyframes.length - 1; i++) t += (state.keyframes[i].duration || 0);
  return t;
}

function selectKeyframe(id) {
  state.selectedKfId = id;
  renderKeyframes();
  renderEditor();
  const kf = state.keyframes.find(k => k.id === id);
  if (kf) {
    applyKeyframeToShapes(kf);
    renderShapes();
    renderShapesPanel();
    if (state.selectedId) showInspector();
  }
}

function applyKeyframeToShapes(kf) {
  for (const s of state.shapes) {
    const snap = kf.shapes[s.id];
    if (!snap) continue;
    s.x = snap.x;
    s.y = snap.y;
    s.width = snap.width;
    s.height = snap.height;
    s.rotation = snap.rotation;
    s.color = snap.color;
    s.opacity = snap.opacity;
    if (snap.drawOn != null) s.drawOn = snap.drawOn;
    if (snap.strokeWidth != null) s.strokeWidth = snap.strokeWidth;
  }
}

// ─── Easings ───
const EASINGS = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => 1 - (1 - t) * (1 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  bounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    else if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    else if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    else { t -= 2.625 / d1; return n1 * t * t + 0.984375; }
  },
  elastic: t => {
    if (t === 0 || t === 1) return t;
    const c = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
  },
};

// ─── Color lerp ───
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const h = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function lerpColor(a, b, t) {
  if (!a || !b) return a || b;
  try {
    const [ar, ag, ab] = hexToRgb(a);
    const [br, bg, bb] = hexToRgb(b);
    return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
  } catch { return a; }
}

// ─── Apply scene at time T ───
function lerp(a, b, t) { return a + (b - a) * t; }

function applyAtTime(timeSec) {
  const kfs = state.keyframes;
  if (kfs.length === 0) return;
  if (kfs.length === 1) {
    applyKeyframeToShapes(kfs[0]);
    renderShapes();
    return;
  }
  // Compute starting time of each kf
  const times = [0];
  for (let i = 1; i < kfs.length; i++) times[i] = times[i - 1] + (kfs[i - 1].duration || 0);
  const total = times[times.length - 1];
  timeSec = clamp(timeSec, 0, total);

  // Find segment
  let i = 0;
  for (let k = 0; k < kfs.length - 1; k++) {
    if (timeSec >= times[k] && timeSec <= times[k + 1]) { i = k; break; }
    if (k === kfs.length - 2) i = k;
  }
  const a = kfs[i], b = kfs[i + 1];
  const dur = (a.duration || 0);
  const localT = dur > 0 ? clamp((timeSec - times[i]) / dur, 0, 1) : 1;
  const eased = (EASINGS[a.easing] || EASINGS.linear)(localT);

  // For each shape, lerp its props from a→b if both exist
  for (const s of state.shapes) {
    const sa = a.shapes[s.id];
    const sb = b.shapes[s.id];
    if (sa && sb) {
      s.x = lerp(sa.x, sb.x, eased);
      s.y = lerp(sa.y, sb.y, eased);
      s.width = lerp(sa.width, sb.width, eased);
      s.height = lerp(sa.height, sb.height, eased);
      s.rotation = lerp(sa.rotation, sb.rotation, eased);
      s.opacity = lerp(sa.opacity, sb.opacity, eased);
      s.color = lerpColor(sa.color, sb.color, eased);
      if (sa.drawOn != null && sb.drawOn != null) s.drawOn = lerp(sa.drawOn, sb.drawOn, eased);
      if (sa.strokeWidth != null && sb.strokeWidth != null) s.strokeWidth = lerp(sa.strokeWidth, sb.strokeWidth, eased);
    } else if (sa) {
      Object.assign(s, sa);
    } else if (sb) {
      Object.assign(s, sb);
    }
  }
  renderShapes();
}

// ─── Playback ───
const playBtn = document.getElementById('play-btn');
const timeCur = document.getElementById('time-cur');
const timeTotal = document.getElementById('time-total');

function play() {
  if (state.keyframes.length < 2) return;
  if (state.playing) return;
  state.playing = true;
  state.playStart = performance.now();
  if (state.playOffset >= totalDuration()) state.playOffset = 0;
  playBtn.textContent = '⏸ PAUSE';
  const tick = () => {
    if (!state.playing) return;
    const elapsed = (performance.now() - state.playStart) / 1000 + state.playOffset;
    const total = totalDuration();
    if (elapsed >= total) {
      applyAtTime(total);
      timeCur.textContent = total.toFixed(1);
      stop();
      return;
    }
    applyAtTime(elapsed);
    timeCur.textContent = elapsed.toFixed(1);
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function stop() {
  if (!state.playing) return;
  const elapsed = (performance.now() - state.playStart) / 1000 + state.playOffset;
  state.playOffset = clamp(elapsed, 0, totalDuration());
  state.playing = false;
  cancelAnimationFrame(state.rafId);
  playBtn.textContent = '▶ PLAY';
}

function reset() {
  stop();
  state.playOffset = 0;
  if (state.keyframes[0]) selectKeyframe(state.keyframes[0].id);
  timeCur.textContent = '0.0';
}

playBtn.addEventListener('click', () => state.playing ? stop() : play());
document.getElementById('reset-btn').addEventListener('click', reset);
document.getElementById('add-kf').addEventListener('click', addKeyframe);

document.getElementById('clear-btn').addEventListener('click', () => {
  if (!confirm('Clear all shapes and keyframes?')) return;
  state.shapes = [];
  state.keyframes = [];
  state.selectedId = null;
  state.selectedKfId = null;
  inspector.classList.add('hidden');
  renderShapes();
  renderShapesPanel();
  renderKeyframes();
  renderEditor();
  saveState();
});

// ─── Render keyframe row + editor ───
const kfList = document.getElementById('kf-list');
const kfEditor = document.getElementById('kf-editor');
const kfDuration = document.getElementById('kf-duration');
const kfEasing = document.getElementById('kf-easing');

function renderKeyframes() {
  kfList.innerHTML = '';
  if (state.keyframes.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'kf-empty';
    empty.textContent = 'NO KEYFRAMES — POSE THE SCENE, HIT + KEYFRAME';
    kfList.appendChild(empty);
  }
  state.keyframes.forEach((kf, i) => {
    const tile = document.createElement('div');
    tile.className = 'kf-tile' + (kf.id === state.selectedKfId ? ' selected' : '');
    const shapeCount = Object.keys(kf.shapes || {}).length;
    tile.innerHTML = `
      <div class="kf-num">K${String(i + 1).padStart(2, '0')}</div>
      <div class="kf-meta">${shapeCount} shp · ${(kf.duration || 0).toFixed(1)}s</div>
    `;
    tile.addEventListener('click', () => selectKeyframe(kf.id));
    kfList.appendChild(tile);

    if (i < state.keyframes.length - 1) {
      const gap = document.createElement('div');
      gap.className = 'kf-gap';
      gap.textContent = `→ ${kf.duration}s · ${kf.easing}`;
      kfList.appendChild(gap);
    }
  });
  timeTotal.textContent = totalDuration().toFixed(1);
}

function renderEditor() {
  if (!state.selectedKfId) { kfEditor.classList.add('hidden'); return; }
  const kf = state.keyframes.find(k => k.id === state.selectedKfId);
  if (!kf) { kfEditor.classList.add('hidden'); return; }
  kfEditor.classList.remove('hidden');
  kfDuration.value = kf.duration;
  kfEasing.value = kf.easing;
}

kfDuration.addEventListener('input', e => {
  const kf = state.keyframes.find(k => k.id === state.selectedKfId);
  if (kf) {
    kf.duration = Math.max(0, parseFloat(e.target.value) || 0);
    renderKeyframes();
    saveState();
  }
});
kfEasing.addEventListener('change', e => {
  const kf = state.keyframes.find(k => k.id === state.selectedKfId);
  if (kf) {
    kf.easing = e.target.value;
    renderKeyframes();
    saveState();
  }
});

const kfUpdate = document.getElementById('kf-update-view');
kfUpdate.addEventListener('click', () => {
  const kf = state.keyframes.find(k => k.id === state.selectedKfId);
  if (!kf) return;
  kf.shapes = snapshotShapes();
  renderKeyframes();
  flashUpdateConfirmation();
  saveState();
});

document.getElementById('kf-delete').addEventListener('click', () => {
  if (state.selectedKfId) deleteKeyframe(state.selectedKfId);
});

function flashUpdateConfirmation() {
  const original = kfUpdate.textContent;
  kfUpdate.textContent = 'Updated ✓';
  kfUpdate.classList.add('flash-ok');
  setTimeout(() => {
    kfUpdate.textContent = original;
    kfUpdate.classList.remove('flash-ok');
  }, 900);
}

// ─── Import / Export JSON ───
document.getElementById('export-btn').addEventListener('click', () => {
  const data = JSON.stringify({
    version: 1,
    shapes: state.shapes,
    keyframes: state.keyframes,
    activeColor: state.activeColor,
  }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'animatedcrazy.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

document.getElementById('import-file').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (Array.isArray(data.shapes)) state.shapes = data.shapes;
    if (Array.isArray(data.keyframes)) state.keyframes = data.keyframes;
    state.selectedId = null;
    state.selectedKfId = state.keyframes[0]?.id ?? null;
    inspector.classList.add('hidden');
    renderShapes();
    renderShapesPanel();
    renderKeyframes();
    renderEditor();
    saveState();
  } catch (err) {
    alert('Failed to parse JSON: ' + err.message);
  }
  e.target.value = '';
});

// ─── Keyboard ───
window.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); state.playing ? stop() : play(); }
  else if (k === 'k') { e.preventDefault(); addKeyframe(); }
  else if (k === 'u' && state.selectedKfId) {
    e.preventDefault();
    kfUpdate.click();
  }
  else if ((e.key === 'Delete' || e.key === 'Backspace')) {
    if (state.selectedId) {
      e.preventDefault();
      insDel.click();
    } else if (state.selectedKfId && e.shiftKey) {
      e.preventDefault();
      deleteKeyframe(state.selectedKfId);
    }
  }
  else if (k === 'v') setActiveTool('select');
  else if (k === 'r') setActiveTool('rect');
  else if (k === 'c') setActiveTool('circle');
  else if (k === 't') setActiveTool('triangle');
  else if (k === 's') setActiveTool('star');
  else if (k === 'w') setActiveTool('squiggly');
  else if (e.key === 'ArrowLeft' && state.selectedKfId) {
    const i = state.keyframes.findIndex(kk => kk.id === state.selectedKfId);
    if (i > 0) selectKeyframe(state.keyframes[i - 1].id);
  }
  else if (e.key === 'ArrowRight' && state.selectedKfId) {
    const i = state.keyframes.findIndex(kk => kk.id === state.selectedKfId);
    if (i >= 0 && i < state.keyframes.length - 1) selectKeyframe(state.keyframes[i + 1].id);
  }
});

// ─── GIF rendering ───
const gifModal = document.getElementById('gif-modal');
const gifSpeed = document.getElementById('gif-speed');
const gifFps = document.getElementById('gif-fps');
const gifScale = document.getElementById('gif-scale');
const gifSpeedVal = document.getElementById('gif-speed-val');
const gifFpsVal = document.getElementById('gif-fps-val');
const gifScaleVal = document.getElementById('gif-scale-val');
const gifSummary = document.getElementById('gif-summary');
const gifProgress = document.getElementById('gif-progress');
const gifProgressFill = document.getElementById('gif-progress-fill');
const gifProgressLabel = document.getElementById('gif-progress-label');
const gifGo = document.getElementById('gif-go');

function gifSummaryUpdate() {
  const total = totalDuration();
  const speed = parseFloat(gifSpeed.value) / 100;
  const fps = parseInt(gifFps.value, 10);
  const outDur = speed > 0 ? total / speed : 0;
  const frames = Math.max(0, Math.round(outDur * fps));
  const w = Math.round(state.vw * (parseInt(gifScale.value, 10) / 100));
  const h = Math.round(state.vh * (parseInt(gifScale.value, 10) / 100));
  gifSummary.textContent = `${frames} frames · ${outDur.toFixed(1)}s · ${w}×${h}`;
}

function bindLive(input, valEl) {
  input.addEventListener('input', () => {
    valEl.textContent = input.value;
    gifSummaryUpdate();
  });
}
bindLive(gifSpeed, gifSpeedVal);
bindLive(gifFps, gifFpsVal);
bindLive(gifScale, gifScaleVal);

document.getElementById('gif-btn').addEventListener('click', () => {
  if (state.keyframes.length < 2) {
    alert('Add at least 2 keyframes first.');
    return;
  }
  gifProgress.classList.add('hidden');
  gifGo.disabled = false;
  gifGo.textContent = 'Render';
  gifSummaryUpdate();
  gifModal.classList.remove('hidden');
});
document.getElementById('gif-cancel').addEventListener('click', () => {
  gifModal.classList.add('hidden');
});

// Render the current SVG frame into an off-screen canvas of size w×h.
async function svgToCanvas(w, h) {
  const xml = new XMLSerializer().serializeToString(canvas);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#fffdf7';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return off;
  } finally {
    URL.revokeObjectURL(url);
  }
}

gifGo.addEventListener('click', async () => {
  stop();
  const total = totalDuration();
  const speedPct = parseFloat(gifSpeed.value);
  const speed = speedPct / 100;
  const fps = parseInt(gifFps.value, 10);
  const scalePct = parseInt(gifScale.value, 10) / 100;
  const outDur = total / speed;
  const totalFrames = Math.max(1, Math.round(outDur * fps));
  const w = Math.round(state.vw * scalePct);
  const h = Math.round(state.vh * scalePct);

  const gif = new GIF({
    workers: 2,
    quality: 8,
    width: w,
    height: h,
    workerScript: gifWorkerUrl,
    repeat: 0,
  });

  gif.on('progress', p => {
    gifProgressFill.style.width = (50 + p * 50) + '%';
    gifProgressLabel.textContent = `Encoding GIF · ${Math.round(p * 100)}%`;
  });
  gif.on('finished', blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `animatedcrazy-${speedPct}pct-${fps}fps.gif`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    gifProgressLabel.textContent = 'Done.';
    gifGo.disabled = false;
    gifGo.textContent = 'Render';
  });

  gifProgress.classList.remove('hidden');
  gifProgressFill.style.width = '0%';
  gifProgressLabel.textContent = 'Capturing frames…';
  gifGo.disabled = true;
  gifGo.textContent = 'Rendering…';

  // Hide selection frame during capture
  const prevSelected = state.selectedId;
  state.selectedId = null;

  const timelineStepPerFrame = (1 / fps) * speed;
  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(total, i * timelineStepPerFrame);
    applyAtTime(t);
    // wait a tick for SVG to update
    await new Promise(r => requestAnimationFrame(r));
    const off = await svgToCanvas(w, h);
    gif.addFrame(off, { copy: true, delay: Math.round(1000 / fps) });
    gifProgressFill.style.width = ((i + 1) / totalFrames * 50) + '%';
    gifProgressLabel.textContent = `Capturing · ${i + 1} / ${totalFrames}`;
  }
  state.selectedId = prevSelected;
  renderShapes();

  gifProgressLabel.textContent = 'Encoding GIF…';
  gif.render();
});

// ─── Initial render ───
renderShapes();
renderShapesPanel();
renderKeyframes();
renderEditor();
if (state.keyframes[0] && !state.selectedKfId) {
  state.selectedKfId = state.keyframes[0].id;
  renderKeyframes();
  renderEditor();
}
