/* THE FAMILY MOUNTAIN — renderer + buttery continuous zoom.
 * Two views:
 *   HEIGHT   — cumulative climb, descents collapsed so it rises like a real
 *              mountain (no awkward flat). Smooth Catmull-Rom curve.
 *   DISTANCE — cumulative miles travelled, the mileage story.
 * Everything redraws as vector each frame under the d3-zoom transform → crisp
 * at any scale, never pixelates.
 */
(function () {
  const DATA = window.FAMILY_MOUNTAIN_DATA;
  if (!DATA || !DATA.hikes.length) { document.body.innerHTML = "<p style='padding:40px'>No hike data. Run build/gpx-to-hike.ts</p>"; return; }

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COL = { orange: css("--orange"), orangeDeep: css("--orange-deep"), ink: css("--ink"),
    inkSoft: css("--ink-soft"), paper: css("--paper"), grid: css("--grid"),
    gridStrong: css("--grid-strong"), red: css("--red") };

  const canvas = document.getElementById("mtn");
  const ctx = canvas.getContext("2d");
  const hov = document.getElementById("hov");
  const hctx = hov.getContext("2d");
  const PAD = { l: 66, r: 54, t: 44, b: 52 };
  const headImg = new Image(); let headReady = false;   // the ski-game obstacle (a friend's face)
  headImg.onload = () => { headReady = true; }; headImg.src = "assets/head.png";

  // two vibes
  const THEME = {
    clean:   { fillBg: true,  lineW: 0.6,  lineAlpha: 0.5,  step: 3, ridge: "#1A1A1A", red: "#CB3B22", marker: "dot",    axis: "#9a958a",
      hikes: [[26,26,26],[30,44,58],[54,38,28],[28,50,40],[50,32,52],[52,46,24],[24,42,52],[54,34,30]],
      ridgeHikes: ["#1A1A1A", "#A2401F", "#2C5E6B", "#6B4E8C", "#4F6B2E", "#9A6B22", "#3B4F7A", "#8A3B55"] },
    vintage: { fillBg: false, lineW: 0.45, lineAlpha: 0.82, step: 1, ridge: "#1c130b", red: "#B0402A", marker: "circle", axis: "#7a6442",
      hikes: [[30,22,12],[26,32,40],[48,32,14],[20,38,30],[44,24,40],[48,42,18],[22,36,30],[50,34,18]],
      ridgeHikes: ["#241813", "#9A3A1E", "#2E5550", "#5A4530", "#6B3A2A", "#7A5A22", "#3E4A5A", "#6B3A4A"] },
  };
  const TH = () => THEME[theme];
  const CONTOUR_STEPS = 150;

  // per-hike palette (Müller-Brockmann) — each hike its own colour so the range grows visibly
  const PALETTE = ["#D8542A", "#2E7D80", "#E6A92B", "#B23A48", "#3D5A6C", "#7A6F9B", "#4F7942", "#C2703D"];
  const darken = (hex, f) => {
    const h = hex.replace("#", "");
    const r = Math.round(parseInt(h.slice(0, 2), 16) * (1 - f)), g = Math.round(parseInt(h.slice(2, 4), 16) * (1 - f)), b = Math.round(parseInt(h.slice(4, 6), 16) * (1 - f));
    return `rgb(${r},${g},${b})`;
  };

  // ===== REVEAL ANIMATION — the poster narrates its own construction =====
  const MOTION = {
    playDur: 5600, loadDur: 3800,
    axis: { s: 0, d: 440 }, ridge: { s: 380, dPlay: 2050, dLoad: 1450 },
    field: { s: 1550, d: 1850 }, lm: { s: 3000, d: 360, stag: 130 },
    brk: { s: 3600, d: 320, stag: 120 }, summit: { s: 4400, d: 640, ring: 540 }, num: { s: 4200, d: 1400 },
  };
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const subAt = (el, s, d) => clamp01((el - s) / d);
  let revealActive = false, revealRAF = null, revealStart = 0, revealDur = 0, revealP = 1, revealLoad = false, revealSkip = false, skipT0 = 0, skipFrom = 0, RV = null;
  function startReveal(isLoad) {
    revealDur = isLoad ? MOTION.loadDur : MOTION.playDur;
    revealStart = 0; revealP = 0; revealLoad = isLoad; revealActive = true; revealSkip = false;
    hover = null; renderHover();
    const b = document.getElementById("play"); if (b) b.classList.add("playing");
    if (revealRAF) cancelAnimationFrame(revealRAF);
    revealRAF = requestAnimationFrame(revealLoop);
  }
  function skipReveal() { if (!revealActive || revealSkip) return; revealSkip = true; skipT0 = performance.now(); skipFrom = revealP; }
  function revealLoop(ts) {
    if (!revealActive) return;
    if (!revealStart) revealStart = ts;
    revealP = revealSkip ? skipFrom + (1 - skipFrom) * clamp01((performance.now() - skipT0) / 220)
      : clamp01((ts - revealStart) / revealDur);
    render();
    if (revealP >= 1) { revealActive = false; const b = document.getElementById("play"); if (b) b.classList.remove("playing"); render(); renderHover(); return; }
    revealRAF = requestAnimationFrame(revealLoop);
  }

  // ---------- build both series ----------
  function smooth(ys, win) {
    const half = win >> 1, out = new Array(ys.length);
    for (let i = 0; i < ys.length; i++) {
      const lo = Math.max(0, i - half), hi = Math.min(ys.length - 1, i + half);
      let s = 0; for (let k = lo; k <= hi; k++) s += ys[k];
      out[i] = s / (hi - lo + 1);
    }
    return out;
  }
  function downsample(pts, max) {
    if (pts.length <= max) return pts;
    const step = pts.length / max, out = [];
    for (let i = 0; i < pts.length; i += step) out.push(pts[Math.floor(i)]);
    if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
    return out;
  }

  // HEIGHT: x = real horizontal distance spent ASCENDING (steep pitches read steep,
  //   gentle traverses stretch out → natural ridge character, like the AllTrails line).
  //   y = each real elevation rise, scaled to end exactly at the honest total.
  // DISTANCE: every point, y = cumulative metres travelled.
  let gCum = 0, gDist = 0, gClimb = 0, idx = 0;
  const Hsegs = [], Dsegs = [], hikeMarks = [];
  DATA.hikes.forEach((h, hi) => {
    const color = PALETTE[hi % PALETTE.length];
    const Hpts = [], Dpts = [];
    let naive = 0, pe = h.series[0].ele;
    h.series.forEach((p, i) => { if (i > 0 && p.ele > pe) naive += p.ele - pe; pe = p.ele; });
    const scale = naive > 0 ? h.stats.gainM / naive : 1;
    let prevD = 0, prevEle = h.series[0].ele, yg = 0;
    Hpts.push({ x: gClimb, y: gCum });
    h.series.forEach((p, i) => {
      if (i > 0 && p.ele > prevEle) { gClimb += p.d - prevD; yg += (p.ele - prevEle) * scale; Hpts.push({ x: gClimb, y: gCum + yg }); }
      Dpts.push({ x: idx++, y: gDist + p.d });
      prevEle = p.ele; prevD = p.d;
    });
    Hpts.push({ x: gClimb, y: gCum + h.stats.gainM });
    gCum += h.stats.gainM; gDist += h.stats.distanceM;
    hikeMarks.push({ x: gClimb, y: gCum, label: "HIKE " + (hi + 1), name: h.name });
    // barely smooth — keep the real GPS texture AllTrails shows; just kill the 0.1m stair artifacts
    const Hs = smooth(Hpts.map((p) => p.y), 2).map((y, i) => ({ x: Hpts[i].x, y }));
    const Ds = smooth(Dpts.map((p) => p.y), 5).map((y, i) => ({ x: Dpts[i].x, y }));
    Hsegs.push({ color, name: h.name, gain: h.stats.gainM, pts: downsample(Hs, 700) });
    Dsegs.push({ color, name: h.name, pts: downsample(Ds, 240) });
  });
  const TOTAL_GAIN = gCum, TOTAL_DIST = gDist;
  // extend the world rightward so you can scroll past the ridge to see future goals
  const RIDGE_XMAX = Math.max(1, gClimb);
  const GOALS_PAD = RIDGE_XMAX * 0.15; // breathing room between ridge end and first goal
  const highestLandmark = window.LANDMARKS ? Math.max(...window.LANDMARKS.map(l => l.h)) : 0;
  const numGoals = window.LANDMARKS ? window.LANDMARKS.filter(l => l.h > TOTAL_GAIN).length : 0;
  const GOALS_ZONE = numGoals > 0 ? RIDGE_XMAX * 0.6 : 0; // right-side zone for future landmarks
  const H_XMAX = RIDGE_XMAX + GOALS_PAD + GOALS_ZONE;
  const D_XMAX = Math.max(1, idx - 1);
  // contour-point index where each hike's x-band ends (all lines share x-sampling)
  // contours only cover the ridge, not the goals zone
  const boundIdx = hikeMarks.map((m) => Math.min(CONTOUR_STEPS, Math.round((m.x / RIDGE_XMAX) * CONTOUR_STEPS)));

  const VIEW = {
    height: { segs: Hsegs, xMax: H_XMAX, yMax: Math.max(highestLandmark * 1.12, TOTAL_GAIN * 1.16, 200),
      kind: "elev", yLabel: "CUMULATIVE CLIMB", xLabel: "THE CLIMB  →", landmarks: window.LANDMARKS, total: TOTAL_GAIN },
    distance: { segs: Dsegs, xMax: D_XMAX, yMax: Math.max(TOTAL_DIST * 1.16, 6000),
      kind: "dist", yLabel: "DISTANCE TRAVELLED", xLabel: "THE HIKE  →", landmarks: window.DIST_LANDMARKS, total: TOTAL_DIST },
  };

  VIEW.height.ridge = Hsegs.flatMap((s) => s.pts);
  VIEW.distance.ridge = Dsegs.flatMap((s) => s.pts);

  // Precompute the topographic CONTOUR FIELD for the height view: many lines that
  // morph from a flat base (f→0) up to the ridge (f→1), warped by coherent sine-noise
  // so they flow and bunch like a topo map. Built once (deterministic) → just
  // transform+stroke each frame, so it never shimmers and stays cheap.
  const contour = (() => {
    const R = VIEW.height.ridge, NC = 150, STEPS = CONTOUR_STEPS, lines = [];
    for (let k = 1; k <= NC; k++) {
      const f = k / (NC + 1);
      const amp = TOTAL_GAIN * 0.02 * Math.sin(Math.PI * f); // most warp in the middle bands
      const ln = [];
      for (let s = 0; s <= STEPS; s++) {
        const x = (s / STEPS) * RIDGE_XMAX, u = s / STEPS;
        const r = ridgeYAt(R, x);
        const w = amp * (0.6 * Math.sin(u * 23 + k * 0.7) + 0.4 * Math.sin(u * 8 - k * 1.3) + 0.25 * Math.sin(u * 44 + k * 0.45));
        let y = f * r + w;
        if (y > r) y = r; if (y < 0) y = 0;
        ln.push({ x, y });
      }
      lines.push(ln);
    }
    return lines;
  })();

  let mode = "height", unit = "ft", hover = null, theme = "clean", interacting = false, showLandmarks = true;
  const V = () => VIEW[mode];

  // ---------- unit formatting ----------
  const elevDisp = (m) => (unit === "ft" ? m * 3.28084 : m);
  const elevU = () => (unit === "ft" ? "ft" : "m");
  const distDisp = (m) => (unit === "ft" ? m / 1609.34 : m / 1000);
  const distU = () => (unit === "ft" ? "mi" : "km");
  const fmtElev = (m, u = true) => `${Math.round(elevDisp(m)).toLocaleString()}${u ? " " + elevU() : ""}`;
  const fmtDist = (m, u = true) => {
    const v = distDisp(m); return `${v >= 100 ? Math.round(v) : v.toFixed(1)}${u ? " " + distU() : ""}`;
  };
  const fmtY = (m, u) => (V().kind === "elev" ? fmtElev(m, u) : fmtDist(m, u));

  // ---------- geometry ----------
  let W = 0, H = 0, BX = 1, BY = 1, dpr = 1;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // retina × 150 strokes is the paint cost — cap it
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    hov.width = W * dpr; hov.height = H * dpr;
    BX = (W - PAD.l - PAD.r) / V().xMax;
    BY = (H - PAD.t - PAD.b) / V().yMax;
  }
  const wx = (x) => PAD.l + x * BX;
  const wy = (y) => (H - PAD.b) - y * BY;
  let T = d3.zoomIdentity;
  const sx = (x) => T.applyX(wx(x));
  // y is PEGGED to the bottom (0 ft always sits at H-PAD.b); only the vertical
  // SCALE follows zoom (k). No vertical pan → baseline anchored to the floor.
  const sy = (y) => (H - PAD.b) - y * BY * T.k;
  const yAtScreen = (py) => ((H - PAD.b) - py) / (BY * T.k);

  function niceStep(range, target) {
    const raw = range / target, pow = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / pow;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
  }

  // Catmull-Rom area + ridge
  function drawCurve(pts, color) {
    if (pts.length < 2) return;
    const baseY = sy(0);
    const P = pts.map((p) => [sx(p.x), sy(p.y)]);
    // filled area
    ctx.beginPath();
    ctx.moveTo(P[0][0], baseY); ctx.lineTo(P[0][0], P[0][1]);
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    ctx.lineTo(P[P.length - 1][0], baseY); ctx.closePath();
    const top = Math.min(...P.map((p) => p[1]));
    const grad = ctx.createLinearGradient(0, top, 0, baseY);
    grad.addColorStop(0, hexA(color, 0.92)); grad.addColorStop(1, hexA(color, 0.5));
    ctx.fillStyle = grad; ctx.fill();
    // ridge line
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]);
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || P[i + 1];
      ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
    }
    ctx.strokeStyle = darken(color, 0.28); ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
  }

  function render() {
    const v = V(), th = TH();
    // reveal fraction bundle (null when idle → every gate is a no-op)
    if (revealActive) {
      const el = revealP * revealDur, rDur = revealLoad ? MOTION.ridge.dLoad : MOTION.ridge.dPlay;
      RV = { el, load: revealLoad,
        axis: easeOutCubic(subAt(el, MOTION.axis.s, MOTION.axis.d)),
        ridge: easeInOutCubic(subAt(el, MOTION.ridge.s, rDur)),
        field: easeOutCubic(subAt(el, MOTION.field.s, MOTION.field.d)),
        num: easeOutExpo(subAt(el, MOTION.num.s, MOTION.num.d)) };
    } else RV = null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (th.fillBg) { ctx.fillStyle = COL.paper; ctx.fillRect(0, 0, W, H); } // vintage stays transparent so the paper texture shows

    // y-axis — labels + short ticks only (no gridlines), poster style
    const yTop = yAtScreen(PAD.t), yBot = yAtScreen(H - PAD.b);
    const rangeDispY = Math.max(0.001, v.kind === "elev" ? elevDisp(yTop - yBot) : distDisp(yTop - yBot));
    const stepDispY = niceStep(rangeDispY, 8);
    const stepMY = v.kind === "elev" ? (unit === "ft" ? stepDispY / 3.28084 : stepDispY)
      : (unit === "ft" ? stepDispY * 1609.34 : stepDispY * 1000);
    ctx.font = "600 11px 'Helvetica Neue'"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    ctx.save(); if (RV) ctx.globalAlpha = RV.axis;
    const aStart = Math.floor(Math.max(0, yBot) / stepMY) * stepMY;
    let first = true;
    for (let a = aStart; a <= yTop + stepMY; a += stepMY) {
      if (a < 0) continue;
      const y = sy(a);
      if (y < PAD.t - 14 || y > H - PAD.b + 14) continue;
      ctx.fillStyle = th.axis;
      ctx.fillText(fmtY(a, false) + (first ? "  " + (v.kind === "elev" ? elevU() : distU()).toUpperCase() : ""), 12, y);
      ctx.strokeStyle = th.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.l - 12, y); ctx.lineTo(PAD.l - 4, y); ctx.stroke();
      // vintage ruler: fine minor ticks between labels
      if (theme === "vintage") {
        for (let t2 = 1; t2 < 5; t2++) {
          const ya = sy(a + (stepMY / 5) * t2); if (ya < PAD.t || ya > H - PAD.b) continue;
          ctx.beginPath(); ctx.moveTo(PAD.l - 9, ya); ctx.lineTo(PAD.l - 5, ya); ctx.stroke();
        }
      }
      first = false;
    }
    ctx.restore(); // end axis-alpha

    ctx.save();
    ctx.beginPath(); ctx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b); ctx.clip();

    if (mode === "height") {
      // topographic contour field. Each hike tints its own x-band a subtly different
      // hue. While zooming/panning we draw a sparse subset (cheap), full on idle.
      ctx.lineWidth = th.lineW; ctx.lineJoin = "round";
      const fF = RV ? RV.field : 1;                       // field "develops like a photo"
      const cstep = RV ? (fF < 0.5 ? 6 : th.step) : (interacting ? 6 : th.step);
      const k = T.k, tx = T.x, ty = T.y, pl = PAD.l, hb = H - PAD.b;
      const hk = th.hikes, alpha = th.lineAlpha, nb = boundIdx.length;
      ctx.save(); if (RV) ctx.globalAlpha = fF;
      for (let li = 0; li < contour.length; li += cstep) {
        const ln = contour[li];
        let start = 0;
        for (let hi = 0; hi < nb; hi++) {
          const end = boundIdx[hi]; if (end <= start) continue;
          const rgb = hk[hi % hk.length];
          ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
          ctx.beginPath();
          for (let i = start; i <= end && i < ln.length; i++) {
            const X = tx + k * (pl + ln[i].x * BX), Y = hb - ln[i].y * fF * BY * k; // rise from baseline + pegged
            i === start ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          }
          ctx.stroke();
          start = end;
        }
      }
      ctx.restore();
    } else {
      drawDistanceLandmarks();
    }

    // ridge line on top of the field — tinted per hike (each its own subtle hue)
    const R = v.ridge;
    ctx.lineWidth = theme === "vintage" ? 1.6 : 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
    const frontX = (RV ? RV.ridge : 1) * R[R.length - 1].x;   // the line "surveys on" left→right
    let tipX = null, tipY = null, hitFront = false;
    if (mode === "height" && hikeMarks.length) {
      let xa = -Infinity;
      for (let hi = 0; hi < hikeMarks.length && !hitFront; hi++) {
        const xb = hikeMarks[hi].x;
        ctx.strokeStyle = th.ridgeHikes[hi % th.ridgeHikes.length]; ctx.beginPath(); let moved = false;
        for (let i = 0; i < R.length; i++) {
          if (R[i].x < xa) continue;
          if (R[i].x > frontX) {                 // reached the drawing frontier → interpolate the tip & stop
            const a = R[i - 1] || R[i], b = R[i], t = (frontX - a.x) / ((b.x - a.x) || 1);
            tipX = sx(frontX); tipY = sy(a.y + (b.y - a.y) * t);
            moved ? ctx.lineTo(tipX, tipY) : ctx.moveTo(tipX, tipY);
            hitFront = true; break;
          }
          const X = sx(R[i].x), Y = sy(R[i].y);
          moved ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), moved = true);
          if (R[i].x > xb) break; // hike seam
        }
        ctx.stroke(); xa = xb;
      }
    } else {
      ctx.strokeStyle = th.ridge; ctx.beginPath(); let moved = false;
      for (let i = 0; i < R.length; i++) { if (R[i].x > frontX) break; const X = sx(R[i].x), Y = sy(R[i].y); moved ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), moved = true); }
      ctx.stroke();
    }
    // wet-ink draw cursor riding the frontier (charcoal, never red — red is the summit's)
    if (RV && RV.ridge < 1 && tipX != null) {
      ctx.fillStyle = hexA(th.ridge, 0.26); ctx.beginPath(); ctx.arc(tipX, tipY, 6, 0, 7); ctx.fill();
      ctx.fillStyle = th.ridge; ctx.beginPath(); ctx.arc(tipX, tipY, 2.3, 0, 7); ctx.fill();
    }

    if (mode === "height" && showLandmarks) drawLandmarkSkyline();
    if (mode === "height" && theme === "clean") drawSummit();

    ctx.restore();
    if (mode === "height") drawHikeAxis();
    hctx.setTransform(1, 0, 0, 1, 0, 0); hctx.clearRect(0, 0, hov.width, hov.height); // stale hover cleared
    updateHUD();
  }

  // each hike bracketed + labeled BELOW the x-axis, in its own colour
  function drawHikeAxis() {
    const th = TH(), y = (H - PAD.b) + 15;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    let xa = 0;
    hikeMarks.forEach((m, i) => {
      const a = Math.max(PAD.l, sx(xa)), b = Math.min(W - PAD.r, sx(m.x));
      xa = m.x;
      if (b - a < 14) return;
      const f = RV ? easeOutQuart(subAt(RV.el, MOTION.brk.s + i * MOTION.brk.stag, MOTION.brk.d)) : 1;
      if (f <= 0.001) return;
      const col = th.ridgeHikes[i % th.ridgeHikes.length];
      const be = a + 3 + (b - 3 - (a + 3)) * f;   // span draws left→right
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a + 3, y); ctx.lineTo(be, y);
      ctx.moveTo(a + 3, y - 4); ctx.lineTo(a + 3, y + 4);
      if (f > 0.96) { ctx.moveTo(b - 3, y - 4); ctx.lineTo(b - 3, y + 4); }
      ctx.stroke();
      ctx.save(); ctx.globalAlpha = clamp01((f - 0.4) / 0.6);
      ctx.fillStyle = col; ctx.font = "800 10px 'Helvetica Neue'";
      ctx.fillText(`HIKE ${i + 1}`, (a + b) / 2, y + 7);
      ctx.restore();
    });
  }

  function drawHikeMarks() {
    const th = TH();
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    hikeMarks.forEach((m, mi) => {
      const px = sx(m.x), py = sy(m.y);
      if (px < PAD.l - 4 || px > W - PAD.r + 4) return;
      if (th.marker === "circle") {
        // numbered red circle floating just above the ridge, with a short tick down to it
        const cy = py - 22, r = 11;
        ctx.strokeStyle = th.red; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(px, py - 2); ctx.lineTo(px, cy + r); ctx.stroke();
        ctx.beginPath(); ctx.arc(px, cy, r, 0, 7); ctx.stroke();
        ctx.fillStyle = th.red; ctx.font = "700 12px 'Helvetica Neue'"; ctx.textBaseline = "middle";
        ctx.fillText(String(mi + 1), px, cy + 0.5);
        ctx.beginPath(); ctx.arc(px, py, 2.4, 0, 7); ctx.fill();
        ctx.textBaseline = "alphabetic";
      } else {
        if (mi < hikeMarks.length - 1) { // clean: summit gets the triangle instead of a label
          ctx.fillStyle = th.ridge; ctx.font = "700 11px 'Helvetica Neue'";
          ctx.fillText(m.label, px, py - 15);
        }
        ctx.fillStyle = th.red; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
        ctx.strokeStyle = COL.paper; ctx.lineWidth = 1.6; ctx.stroke();
      }
    });
  }
  function drawSummit() {
    const m = hikeMarks[hikeMarks.length - 1]; if (!m) return;
    const px = sx(m.x), py = sy(m.y);
    if (px < PAD.l - 4 || px > W - PAD.r + 4) return;
    const red = TH().red;
    const dotF = RV ? clamp01(subAt(RV.el, MOTION.summit.s, 120)) : 1;
    const poleF = RV ? easeOutQuart(subAt(RV.el, MOTION.summit.s + 120, 240)) : 1;
    const pennF = RV ? clamp01(subAt(RV.el, MOTION.summit.s + 360, 220)) : 1;
    if (dotF <= 0.001) return;
    // flag PLANTED on the exact peak — it plants over ~0.6s during the reveal, instant otherwise
    ctx.fillStyle = red; ctx.strokeStyle = red; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.arc(px, py, 2.6 * dotF, 0, 7); ctx.fill();
    if (poleF > 0) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - 19 * poleF); ctx.stroke(); }
    if (pennF > 0) {
      const topY = py - 19;
      ctx.save(); ctx.beginPath(); ctx.rect(px, topY - 8, 12 * pennF, 14); ctx.clip();   // pennant unfurls left→right
      ctx.beginPath(); ctx.moveTo(px, topY); ctx.lineTo(px + 12, topY + 3.5); ctx.lineTo(px, topY + 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    if (RV && !RV.load) {                                              // one soft red ring — the only celebration beat
      const rf = clamp01(subAt(RV.el, MOTION.summit.s + 360, MOTION.summit.ring));
      if (rf > 0 && rf < 1) { ctx.strokeStyle = hexA(red, 0.5 * (1 - rf)); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 3 + 11 * rf, 0, 7); ctx.stroke(); }
    }
  }

  // real landmark icons (mingcute, baked in icons.js) standing at true height
  function drawIconAt(c, key, cx, baseY, pxH, color) {
    const ic = window.LANDMARK_ICONS && window.LANDMARK_ICONS[key]; if (!ic) return;
    const vh = ic.vb[3] || 24, vw = ic.vb[2] || 24, s = pxH / vh, w = vw * s;
    c.save();
    c.translate(cx - w / 2, baseY - pxH); c.scale(s, s);
    c.fillStyle = color;
    for (const p of ic.paths) c.fill(new Path2D(p.d), p.rule || "nonzero");
    c.restore();
  }
  // landmarks placed at DATA-x coordinates. Passed landmarks cluster near the
  // ridge; future goals live in the GOALS ZONE to the right so you can scroll
  // over and see what's coming. Each sits at its true y-height.
  // Assign each landmark a stable data-x position:
  const landmarkX = (() => {
    const LM = window.LANDMARKS; if (!LM || !LM.length) return [];
    // passed landmarks: spread across the right 40% of the ridge
    // future landmarks: spread across the goals zone beyond the ridge
    const passed = [], future = [];
    LM.forEach((l, i) => (l.h <= TOTAL_GAIN ? passed : future).push({ l, i }));
    const xs = new Array(LM.length);
    // passed: spread from 60% to 100% of ridge
    passed.forEach((p, pi) => {
      xs[p.i] = RIDGE_XMAX * (0.6 + 0.38 * (passed.length <= 1 ? 0.5 : pi / (passed.length - 1)));
    });
    // future: spread across the goals zone
    future.forEach((f, fi) => {
      xs[f.i] = RIDGE_XMAX + GOALS_PAD + GOALS_ZONE * (future.length <= 1 ? 0.5 : fi / (future.length - 1));
    });
    return xs;
  })();

  function drawLandmarkSkyline() {
    const th = TH(), LM = window.LANDMARKS, ICON = 30;
    if (!LM || !LM.length) return;
    ctx.textBaseline = "middle";
    LM.forEach((l, i) => {
      const lx = sx(landmarkX[i]); // data-space → screen
      const ly = sy(l.h);
      // cull if completely off-screen
      if (lx < PAD.l - 60 || lx > W + 60) return;
      if (ly < PAD.t - ICON || ly > H - PAD.b + ICON) return;
      const lf = RV ? easeOutCubic(subAt(RV.el, MOTION.lm.s + i * MOTION.lm.stag, MOTION.lm.d)) : 1;
      if (lf <= 0.001) return;
      ctx.save(); if (RV) ctx.globalAlpha = lf;
      const passed = l.h <= TOTAL_GAIN;
      const col = passed ? th.red : hexA(th.ridge, 0.42);
      // vertical post from baseline up to the landmark height
      ctx.strokeStyle = passed ? hexA(th.red, 0.22) : hexA(th.ridge, 0.10);
      ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(lx, sy(0)); ctx.lineTo(lx, ly); ctx.stroke(); ctx.setLineDash([]);
      // horizontal datum from left edge to the icon
      ctx.strokeStyle = passed ? hexA(th.red, 0.18) : hexA(th.ridge, 0.08);
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(PAD.l, ly); ctx.lineTo(lx - ICON * 0.7, ly); ctx.stroke(); ctx.setLineDash([]);
      // icon
      drawIconAt(ctx, l.shape, lx, ly + ICON / 2, ICON, col);
      // labels
      ctx.textAlign = "center";
      ctx.fillStyle = col; ctx.font = "700 10px 'Helvetica Neue'";
      ctx.fillText(fmtElev(l.h, false), lx, ly - ICON / 2 - 12);
      ctx.fillStyle = passed ? th.axis : hexA(th.axis, 0.6); ctx.font = "600 8.5px 'Helvetica Neue'";
      ctx.fillText(l.name, lx, ly - ICON / 2 - 2);
      // for future goals, add a subtle "NEXT" or goal indicator
      if (!passed) {
        const diff = l.h - TOTAL_GAIN;
        ctx.fillStyle = hexA(th.ridge, 0.35); ctx.font = "700 7.5px 'Helvetica Neue'";
        ctx.fillText(`${fmtElev(diff, false)} ${elevU()} to go`, lx, ly + ICON / 2 + 12);
      }
      ctx.restore();
    });
  }

  // ---------- hover readout (follows the ridge, shows the climb value) ----------
  function ridgeYAt(arr, x) {
    if (!arr || !arr.length) return null;
    if (x <= arr[0].x) return arr[0].y;
    if (x >= arr[arr.length - 1].x) return arr[arr.length - 1].y;
    let lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m].x < x) lo = m; else hi = m; }
    const a = arr[lo], b = arr[hi], t = (x - a.x) / ((b.x - a.x) || 1);
    return a.y + (b.y - a.y) * t;
  }
  // hover lives on its own lightweight overlay canvas — moving the mouse never
  // touches the heavy contour field, so it stays smooth.
  function renderHover() {
    const c = hctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!hover || skiActive) return;
    const v = V(), th = TH();
    if (hover.mx < PAD.l || hover.mx > W - PAD.r || hover.my < PAD.t || hover.my > H - PAD.b) return;
    const xData = ((hover.mx - T.x) / T.k - PAD.l) / BX;
    const yData = ridgeYAt(v.ridge, xData);
    if (yData == null) return;
    const px = sx(xData), py = sy(yData), groundY = Math.min(sy(0), H - PAD.b);
    const ink = th.ridge;
    c.strokeStyle = hexA(ink, 0.5); c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(px, py); c.lineTo(px, groundY); c.stroke(); c.setLineDash([]);
    c.fillStyle = ink; c.beginPath(); c.arc(px, py, 4.5, 0, 7); c.fill();
    const t1 = fmtY(yData), t2 = (v.kind === "elev" ? "CLIMBED" : "TRAVELLED");
    c.font = "700 16px 'Helvetica Neue'"; const w1 = c.measureText(t1).width;
    const bw = w1 + 22, bh = 42;
    const bx = Math.max(PAD.l + 2, Math.min(W - PAD.r - bw - 2, px - bw / 2));
    const by = py - bh - 14 < PAD.t + 2 ? py + 14 : py - bh - 14;
    c.fillStyle = theme === "vintage" ? "#EFE2C4" : COL.paper; c.strokeStyle = ink; c.lineWidth = 1.5;
    c.fillRect(bx, by, bw, bh); c.strokeRect(bx, by, bw, bh);
    c.fillStyle = ink; c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.font = "700 16px 'Helvetica Neue'"; c.fillText(t1, bx + bw / 2, by + 21);
    c.fillStyle = th.axis; c.font = "700 8px 'Helvetica Neue'";
    c.fillText(t2, bx + bw / 2, by + 33);
  }

  function drawHeightLandmarks(baseY, pxPerY) {
    const LM = V().landmarks;
    const gx0 = W * 0.62, gx1 = W - PAD.r - 12, n = LM.length;
    const colW = (gx1 - gx0) / Math.max(1, n - 1), maxW = colW * 0.8;
    LM.forEach((l, i) => {
      const pxH = l.h * pxPerY; if (pxH < 0.5) return;
      const ly = baseY - pxH;
      if (ly < PAD.t - 1 || ly > (H - PAD.b) + 1) return; // only when its top is in view
      const x = gx0 + (n === 1 ? 0.5 : i / (n - 1)) * (gx1 - gx0);
      const passed = l.h <= TOTAL_GAIN;
      // datum
      ctx.strokeStyle = passed ? hexA(COL.orange, 0.28) : hexA(COL.ink, 0.09);
      ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(PAD.l, ly); ctx.lineTo(gx0 - 26, ly); ctx.stroke(); ctx.setLineDash([]);
      // icon
      window.drawLandmark(ctx, l.shape, x, baseY, pxH, passed ? COL.orange : hexA(COL.ink, 0.32), maxW);
      // labels (need headroom above the icon top so the name+height aren't clipped)
      if (ly > PAD.t + 30 && ly < H - PAD.b - 2) {
        ctx.fillStyle = passed ? COL.orangeDeep : COL.inkSoft;
        ctx.font = "700 9.5px 'Helvetica Neue'"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText(fmtElev(l.h, false), x, ly - 4);
        ctx.font = "500 8px 'Helvetica Neue'"; ctx.fillStyle = COL.inkSoft;
        wrapName(l.name, x, ly - 16);
      }
    });
  }

  function drawDistanceLandmarks() {
    const LM = V().landmarks;
    ctx.textBaseline = "middle";
    LM.forEach((l) => {
      const y = sy(l.d); if (y < PAD.t - 2 || y > H - PAD.b + 2) return;
      const passed = l.d <= TOTAL_DIST;
      ctx.strokeStyle = passed ? hexA(COL.red, 0.55) : hexA(COL.ink, 0.18);
      ctx.lineWidth = passed ? 1.4 : 1; ctx.setLineDash(passed ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = passed ? COL.red : COL.inkSoft;
      ctx.textAlign = "right"; ctx.font = "700 10px 'Helvetica Neue'";
      ctx.fillText(`${l.name.toUpperCase()} · ${fmtDist(l.d)}`, W - PAD.r - 8, y - 8);
    });
  }

  function wrapName(name, x, y) {
    const words = name.split(" "); ctx.textAlign = "center";
    if (words.length <= 1) { ctx.fillText(name, x, y); return; }
    const mid = Math.ceil(words.length / 2);
    ctx.fillText(words.slice(0, mid).join(" "), x, y - 9);
    ctx.fillText(words.slice(mid).join(" "), x, y);
  }
  function hexA(hex, a) {
    if (hex.startsWith("rgba")) return hex;
    const h = hex.replace("#", "");
    return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
  }

  function updateHUD() {
    const v = V(), isV = theme === "vintage";
    const total = v.kind === "elev" ? TOTAL_GAIN : TOTAL_DIST;
    const shown = RV ? total * RV.num : total;   // counts up on ease-out-expo during the reveal
    document.getElementById("big-total").textContent = v.kind === "elev" ? fmtElev(shown, false) : fmtDist(shown, false);
    document.getElementById("big-unit").textContent = (v.kind === "elev" ? elevU() : distU()).toUpperCase();
    const sb = document.querySelector(".statbar"); if (sb) sb.style.opacity = RV ? clamp01(subAt(RV.el, MOTION.num.s, 700)) : "";
    document.getElementById("lab1").textContent = isV ? "Hikes:" : "Hikes";
    document.getElementById("lab2").textContent = isV ? "Distance:" : distU();
    document.getElementById("lab3").textContent = isV ? "Season:" : "Season";
    document.getElementById("st-1").textContent = DATA.hikes.length;
    document.getElementById("st-2").textContent = isV ? `${fmtDist(TOTAL_DIST, false)} ${distU().toUpperCase()}` : fmtDist(TOTAL_DIST, false);
    document.getElementById("st-3").textContent = (DATA.hikes[DATA.hikes.length - 1].date || "2026").slice(0, 4);
    document.getElementById("hint").textContent = `${DATA.hikes.length} hikes · hover the ridge · scroll to zoom · drag to pan`;
  }

  // coalesce every interaction to at most one heavy render per animation frame
  let renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); renderHover(); }); }

  // while actively zooming/panning, draw a sparse subset of contour lines (cheap);
  // snap back to full density the instant motion stops.
  const zoom = d3.zoom().scaleExtent([0.35, 60])
    .on("start", () => { interacting = true; })
    .on("zoom", (e) => { T = e.transform; scheduleRender(); })
    .on("end", () => { interacting = false; scheduleRender(); });
  function fitView() { T = d3.zoomIdentity; d3.select(canvas).call(zoom.transform, T); }

  function setMode(m) {
    if (m === mode) return;
    if (revealActive) skipReveal();
    mode = m;
    document.querySelectorAll("#mode-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    layout(); fitView(); render();
  }
  function setUnit(u) {
    if (revealActive) skipReveal();
    unit = u;
    document.querySelectorAll("#unit-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.u === u));
    render();
  }
  document.getElementById("mode-toggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });
  document.getElementById("unit-toggle").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setUnit(b.dataset.u); });
  document.getElementById("reset").addEventListener("click", fitView);
  function setTheme(t) { if (revealActive) skipReveal(); theme = t; document.body.className = "theme-" + t; render(); }
  document.getElementById("vibe").addEventListener("click", () => setTheme(theme === "clean" ? "vintage" : "clean"));
  function setLandmarks(on) { showLandmarks = on; document.getElementById("landmarks").classList.toggle("off", !on); render(); }
  document.getElementById("landmarks").addEventListener("click", () => setLandmarks(!showLandmarks));
  // HEADS toggle — clear-run mode. Gates both drawing and collision, so it
  // works mid-run too: flip it off and the field is instantly safe.
  let headsOn = true;
  document.getElementById("heads").addEventListener("click", () => {
    headsOn = !headsOn;
    document.getElementById("heads").classList.toggle("off", !headsOn);
  });

  let hovPending = false;
  canvas.addEventListener("mousemove", (e) => {
    if (skiActive) return;
    const r = canvas.getBoundingClientRect();
    hover = { mx: e.clientX - r.left, my: e.clientY - r.top };
    if (!hovPending) { hovPending = true; requestAnimationFrame(() => { hovPending = false; renderHover(); }); } // overlay only — field untouched
  });
  canvas.addEventListener("mouseleave", () => { hover = null; renderHover(); });

  // ===================================================================
  //  SKI GAME — drop a skier at the summit, carve down the real ridge
  // ===================================================================
  let skiActive = false, skiRAF = null, ski = null;
  // tuned for FEEL, not real units (the chart's vertical is exaggerated ~4.5x):
  // long satisfying glide, believable speed readout.
  // no hard speed cap — quadratic air drag only (terminal ~390 mph, a numeric
  // safety net, not a feel limit). Acceleration keeps building the whole run.
  const SK = { G: 215, FRIC: 0.16, SUB: 1 / 240, PUSH: 16, DRAG: 0.0001, MPH: 0.32, JUMP: 140, FLIP: 13, COYOTE: 0.12 };

  function enterSki() {
    if (skiActive) return;
    if (mode !== "height") { mode = "height"; document.querySelectorAll("#mode-toggle button").forEach((b) => b.classList.toggle("on", b.dataset.m === "height")); }
    layout();
    // terrain in world-px (k=1), left→right
    const TER = VIEW.height.ridge.map((p) => ({ X: wx(p.x), Y: wy(p.y) })).sort((a, b) => a.X - b.X);
    const terAt = (X) => {
      if (X <= TER[0].X) return TER[0].Y;
      if (X >= TER[TER.length - 1].X) return TER[TER.length - 1].Y;
      let lo = 0, hi = TER.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; TER[m].X < X ? (lo = m) : (hi = m); }
      const a = TER[lo], b = TER[hi]; return a.Y + (b.Y - a.Y) * ((X - a.X) / ((b.X - a.X) || 1));
    };
    const slopeAt = (X) => (terAt(X + 3) - terAt(X - 3)) / 6;
    const sx0 = TER[TER.length - 1].X - 6;
    // THE HEADS — jump over them. Hit one and the run resets. Deterministic field,
    // varied sizes, "every so often" (~70% of slots filled).
    const obstacles = []; let oi = 0;
    for (let X = sx0 - 110; X > TER[0].X + 40; X -= 120) {
      const hh = Math.sin(oi * 12.9898) * 43758.5453, r = hh - Math.floor(hh); oi++;
      if (r < 0.12) continue;                      // occasional gap
      const ox = X + (r - 0.5) * 60;
      const r2 = Math.sin(oi * 78.233) * 19421.3, rr = r2 - Math.floor(r2);
      const size = rr < 0.33 ? 4 + rr * 9 : 7 + r * 9;           // ~1/3 tiny (4–7), rest small (7–16)
      obstacles.push({ x: ox, y: terAt(ox), r: size });
    }
    ski = { TER, terAt, slopeAt, obstacles, initX: sx0, x: sx0, y: terAt(sx0), vx: -SK.PUSH, vy: 0, air: false, wasAir: false, ang: Math.PI,
      spin: 0, spinV: 0, flips: 0, groundT: 0, jumpReq: false, crashed: false, crashAt: 0,
      startY: terAt(sx0), minX: TER[0].X + 6, maxSpd: 0, camX: sx0, camY: terAt(sx0), Z: 4.2, done: false, last: null, acc: 0, sprayT: 0 };
    skiActive = true;
    hover = null; renderHover();
    d3.select(canvas).on(".zoom", null); // suspend pan/zoom during the run
    document.getElementById("hint").textContent = "SKIING — press ESC to exit";
    skiRAF = requestAnimationFrame(skiLoop);
  }
  function exitSki() {
    if (!skiActive) return;
    skiActive = false; if (skiRAF) cancelAnimationFrame(skiRAF); skiRAF = null;
    d3.select(canvas).call(zoom); // restore interaction
    render();
  }

  function skiLoop(ts) {
    if (!skiActive) return;
    const s = ski;
    if (s.last == null) s.last = ts;
    let dt = (ts - s.last) / 1000; s.last = ts; if (dt > 0.05) dt = 0.05;

    if (!s.done && !s.crashed) {
      for (s.acc += dt; s.acc >= SK.SUB; s.acc -= SK.SUB) {
        s.vy += SK.G * SK.SUB;
        s.x += s.vx * SK.SUB; s.y += s.vy * SK.SUB;
        const ty = s.terAt(s.x);
        // Ground falls away under a fast skier on a steep, exaggerated downhill. Treat
        // "riding the tangent" as grounded by allowing the one-substep terrain drop + a
        // small epsilon. A real jump (vy-=125, y-=1.5) far exceeds this band, so launches
        // still read as airborne — this is what makes "grounded" the normal state again.
        const stick = Math.abs(s.slopeAt(s.x) * s.vx) * SK.SUB + 1.5;
        const onG = s.y >= ty - stick;
        if (onG) {
          s.y = ty;                                // re-snap to the surface (the stick force)
          const m = s.slopeAt(s.x), len = Math.hypot(1, m), tx = 1 / len, tyn = m / len;
          let vt = s.vx * tx + s.vy * tyn;
          vt *= (1 - SK.FRIC * SK.SUB);
          s.vx = tx * vt; s.vy = tyn * vt;
          s.sprayT = Math.min(1, Math.abs(vt) / 700);
          if (s.wasAir) { s.flips += Math.round(Math.abs(s.spin) / (2 * Math.PI)); s.spin = 0; s.spinV = 0; } // landed
          s.groundT = 0;                           // freshly grounded → coyote window full
        } else { s.sprayT = 0; s.spin += s.spinV * SK.SUB; s.spinV *= (1 - 0.2 * SK.SUB); s.groundT += SK.SUB; }
        s.air = !onG; s.wasAir = !onG;
        // service a buffered jump the instant we're grounded / inside the coyote window
        if (s.jumpReq && s.groundT <= SK.COYOTE) { s.vy -= SK.JUMP; s.y -= 1.5; s.groundT = SK.COYOTE + 1; s.jumpReq = false; s.air = true; s.wasAir = true; }
        // orient from velocity only → continuous across air/ground, never snaps upside down
        s.ang = Math.atan2(s.vy, s.vx);
        let spd = Math.hypot(s.vx, s.vy);
        const dragF = 1 - SK.DRAG * spd * SK.SUB;   // quadratic drag, no clamp
        s.vx *= dragF; s.vy *= dragF; spd *= dragF;
        if (spd > s.maxSpd) s.maxSpd = spd;
        if (s.x <= s.minX) { s.x = s.minX; s.done = true; s.vx = s.vy = 0; }
        // HEAD collision — you must JUMP OVER. If you're not high enough above it → CRASH.
        if (!s.crashed && headsOn) {
          const obs = s.obstacles;
          const x0 = s.x - s.vx * SK.SUB;           // substep start — swept test so speed can't tunnel past a head
          for (let k = 0; k < obs.length; k++) {
            const o = obs[k];
            // clearance = how high the skier's feet are above the terrain at the head
            const crossed = Math.abs(s.x - o.x) < o.r * 0.7 || (x0 - o.x) * (s.x - o.x) < 0;
            if (crossed && (s.terAt(o.x) - s.y) < o.r * 0.9) {
              s.crashed = true; s.crashAt = 0; s.vx = 0; s.vy = 0; break;
            }
          }
        }
      }
    }
    // crashed → red flash, then auto-restart from the summit
    if (s.crashed) {
      if (!s.crashAt) s.crashAt = ts;
      if (ts - s.crashAt > 1500) {
        s.x = s.initX; s.y = s.terAt(s.initX); s.vx = -SK.PUSH; s.vy = 0;
        s.air = false; s.wasAir = false; s.spin = 0; s.spinV = 0; s.flips = 0; s.groundT = 0;
        s.crashed = false; s.crashAt = 0; s.maxSpd = 0; s.done = false;
        s.camX = s.initX; s.camY = s.terAt(s.initX); s.Z = 4.2; s.last = ts;
      }
    }
    // camera: lead the skier, ease in, zoom out a touch with speed
    const spd = Math.hypot(s.vx, s.vy);
    const tz = Math.max(1.7, 4.2 - spd * 0.0013);   // camera pulls out wide as speed climbs past the old cap
    s.Z += (tz - s.Z) * 0.06;
    const tcx = s.x + s.vx * 0.20, tcy = s.y + s.vy * 0.14 - 30 / s.Z;
    s.camX += (tcx - s.camX) * 0.12; s.camY += (tcy - s.camY) * 0.12;
    drawSki(spd);
    skiRAF = requestAnimationFrame(skiLoop);
  }

  function drawSki(spd) {
    const s = ski, Z = s.Z;
    const SXc = (X) => (X - s.camX) * Z + W / 2, SYc = (Y) => (Y - s.camY) * Z + H * 0.55;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, theme === "vintage" ? "#cdbd97" : "#cfe2ec");
    sky.addColorStop(1, theme === "vintage" ? "#e6d8b6" : "#eef0e8");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // terrain: snow fill + surface line, only the visible window
    const TER = s.TER;
    const x0w = s.camX - (W / 2) / Z - 40, x1w = s.camX + (W / 2) / Z + 40;
    ctx.beginPath(); let started = false;
    for (let i = 0; i < TER.length; i++) {
      if (TER[i].X < x0w || TER[i].X > x1w) { if (started && TER[i].X > x1w) { ctx.lineTo(SXc(TER[i].X), SYc(TER[i].Y)); break; } continue; }
      const X = SXc(TER[i].X), Y = SYc(TER[i].Y);
      started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true);
    }
    const lastX = SXc(Math.min(x1w, TER[TER.length - 1].X));
    ctx.lineTo(lastX, H + 60); ctx.lineTo(SXc(Math.max(x0w, TER[0].X)), H + 60); ctx.closePath();
    ctx.fillStyle = theme === "vintage" ? "#efe7d2" : "#fbfbfa"; ctx.fill();
    ctx.strokeStyle = theme === "vintage" ? "#3a2c18" : "#1A1A1A"; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
    // redraw just the surface line on top
    ctx.beginPath(); started = false;
    for (let i = 0; i < TER.length; i++) {
      if (TER[i].X < x0w || TER[i].X > x1w) continue;
      const X = SXc(TER[i].X), Y = SYc(TER[i].Y); started ? ctx.lineTo(X, Y) : (ctx.moveTo(X, Y), started = true);
    }
    ctx.stroke();

    // THE HEADS — circle-clipped photo obstacles resting on the snow, varied sizes
    for (let k = 0; k < (headsOn ? s.obstacles.length : 0); k++) {
      const o = s.obstacles[k];
      if (o.x < x0w || o.x > x1w) continue;
      const ox = SXc(o.x), baseY = SYc(o.y), Rr = o.r * Z, cy = baseY - Rr; // sits on terrain
      if (headReady) {
        ctx.save();
        ctx.beginPath(); ctx.arc(ox, cy, Rr, 0, 7); ctx.closePath(); ctx.clip();
        const iw = headImg.width, ih = headImg.height, sc = Math.max((2 * Rr) / iw, (2 * Rr) / ih);
        const dw = iw * sc, dh = ih * sc;
        ctx.drawImage(headImg, ox - dw / 2, cy - dh / 2 - Rr * 0.12, dw, dh); // bias up so the face centers
        ctx.restore();
      } else {
        ctx.fillStyle = TH().red; ctx.beginPath(); ctx.arc(ox, cy, Rr, 0, 7); ctx.fill();
      }
    }

    // skier
    const px = SXc(s.x), py = SYc(s.y);
    // snow spray
    if (s.sprayT > 0.15 && !s.air) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (let i = 0; i < 6; i++) { const a = s.ang + Math.PI - 0.5 + i * 0.16; const d = 6 + i * 3 * s.sprayT; ctx.beginPath(); ctx.arc(px + Math.cos(a) * d, py + Math.sin(a) * d - 4, 1.6 + s.sprayT, 0, 7); ctx.fill(); }
    }
    const red = TH().red;
    // base tilt from velocity, clamped so it never passes vertical; trick spin added on top
    let baseTilt = s.ang - Math.PI;
    baseTilt = Math.atan2(Math.sin(baseTilt), Math.cos(baseTilt));
    baseTilt = Math.max(-1.15, Math.min(1.15, baseTilt));
    ctx.save(); ctx.translate(px, py); ctx.rotate(baseTilt + s.spin); ctx.scale(0.6, 0.6); // smaller skier — feels like a longer mountain
    ctx.strokeStyle = red; ctx.fillStyle = red; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(11, 3); ctx.lineTo(-12, 3); ctx.lineTo(-15, 0); ctx.stroke();   // ski (faces left)
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(-3, -6); ctx.lineTo(0, -13); ctx.stroke();      // leg + torso
    ctx.beginPath(); ctx.moveTo(-2, -8); ctx.lineTo(-9, -6); ctx.stroke();                         // arm
    ctx.beginPath(); ctx.arc(0, -16, 3.2, 0, 7); ctx.fill();                                       // head
    ctx.restore();

    // HUD
    ctx.textBaseline = "alphabetic";
    const dropFt = Math.max(0, Math.round(((s.y - s.startY) / BY) * 3.28084));
    const mph = Math.round(spd * SK.MPH);
    ctx.fillStyle = TH().ridge; ctx.textAlign = "left";
    ctx.font = "800 13px 'Helvetica Neue'"; ctx.fillText("⛷  SKIING THE FAMILY MOUNTAIN", 22, 34);
    ctx.font = "800 28px 'Helvetica Neue'"; ctx.fillText(`${dropFt.toLocaleString()} ft`, 22, 66);
    ctx.font = "700 11px 'Helvetica Neue'"; ctx.fillStyle = TH().axis; ctx.fillText("DESCENDED", 22, 80);
    ctx.fillStyle = red; ctx.font = "800 22px 'Helvetica Neue'"; ctx.textAlign = "right"; ctx.fillText(`${mph} mph`, W - 22, 66);
    ctx.fillStyle = TH().axis; ctx.font = "700 11px 'Helvetica Neue'"; ctx.fillText(s.air ? "AIRBORNE!" : "SPEED", W - 22, 80);
    // controls hint + trick counter
    ctx.textAlign = "center"; ctx.fillStyle = TH().axis; ctx.font = "700 11px 'Helvetica Neue'";
    ctx.fillText("SPACE / TAP — JUMP    ·    IN AIR, TAP AGAIN — FLIP", W / 2, H - 22);
    if (s.flips > 0) { ctx.fillStyle = red; ctx.textAlign = "left"; ctx.font = "800 17px 'Helvetica Neue'"; ctx.fillText(`FLIPS ×${s.flips}`, 22, 104); }
    if (s.air && Math.abs(s.spin) > 0.4) { ctx.fillStyle = red; ctx.textAlign = "center"; ctx.font = "800 22px 'Helvetica Neue'"; ctx.fillText("FLIP!", px, py - 32); }

    if (s.crashed) {                                   // hit a head → screen goes red, then restarts
      ctx.fillStyle = "rgba(198,32,34,0.6)"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.font = "900 58px 'Helvetica Neue'"; ctx.fillText("OUCH!", W / 2, H / 2 - 6);
      ctx.font = "700 17px 'Helvetica Neue'"; ctx.fillText("you hit a head — restarting…", W / 2, H / 2 + 30);
      return;
    }

    if (s.done) {
      ctx.fillStyle = "rgba(20,16,10,0.5)"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center"; ctx.fillStyle = "#fff";
      ctx.font = "800 40px 'Helvetica Neue'"; ctx.fillText("RUN COMPLETE", W / 2, H / 2 - 30);
      ctx.fillStyle = red; ctx.font = "800 30px 'Helvetica Neue'"; ctx.fillText(`${dropFt.toLocaleString()} ft descended`, W / 2, H / 2 + 12);
      ctx.fillStyle = "#fff"; ctx.font = "700 16px 'Helvetica Neue'"; ctx.fillText(`top speed ${Math.round(s.maxSpd * SK.MPH)} mph`, W / 2, H / 2 + 42);
      const flipY = s.flips > 0 ? H / 2 + 70 : H / 2 + 42;
      if (s.flips > 0) { ctx.fillStyle = red; ctx.font = "800 18px 'Helvetica Neue'"; ctx.fillText(`${s.flips} FLIP${s.flips > 1 ? "S" : ""} LANDED`, W / 2, flipY); }
      // "PLAY AGAIN" button
      const btnY = flipY + 36, btnW = 180, btnH = 42;
      const btnX = W / 2 - btnW / 2;
      ctx.fillStyle = red;
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(btnX + r, btnY); ctx.lineTo(btnX + btnW - r, btnY);
      ctx.quadraticCurveTo(btnX + btnW, btnY, btnX + btnW, btnY + r);
      ctx.lineTo(btnX + btnW, btnY + btnH - r);
      ctx.quadraticCurveTo(btnX + btnW, btnY + btnH, btnX + btnW - r, btnY + btnH);
      ctx.lineTo(btnX + r, btnY + btnH);
      ctx.quadraticCurveTo(btnX, btnY + btnH, btnX, btnY + btnH - r);
      ctx.lineTo(btnX, btnY + r);
      ctx.quadraticCurveTo(btnX, btnY, btnX + r, btnY);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "800 15px 'Helvetica Neue'";
      ctx.fillText("▶  PLAY AGAIN", W / 2, btnY + btnH / 2 + 1);
      // stash button bounds for click detection
      s.btnRect = { x: btnX, y: btnY, w: btnW, h: btnH };
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "700 11px 'Helvetica Neue'";
      ctx.fillText("SPACE to replay  ·  ESC to exit", W / 2, btnY + btnH + 22);
    }
  }

  // tap/space = jump when grounded, flip when airborne
  function skiInput() {
    if (!skiActive || !ski || ski.done) return;
    const s = ski;
    if (s.groundT <= SK.COYOTE) {                  // on ground or just-left → always JUMP
      s.vy -= SK.JUMP; s.y -= 1.5; s.groundT = SK.COYOTE + 1; s.air = true; s.wasAir = true;
    } else if (s.air) {                            // genuinely airborne → FLIP (+ buffer a jump for landing)
      s.spinV -= SK.FLIP; s.jumpReq = true;
    }
  }
  document.getElementById("ski").addEventListener("click", () => skiActive ? exitSki() : enterSki());
  document.getElementById("play").addEventListener("click", () => { const b = document.getElementById("play"); b.textContent = "▶ Replay"; revealActive ? skipReveal() : startReveal(false); });
  canvas.addEventListener("mousedown", (e) => {
    if (!skiActive) return;
    // check "play again" button click
    if (ski && ski.done && ski.btnRect) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const b = ski.btnRect;
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) { exitSki(); enterSki(); return; }
    }
    skiInput();
  });
  window.addEventListener("keydown", (e) => {
    if (skiActive && (e.key === " " || e.key === "ArrowUp" || e.key === "w")) {
      e.preventDefault();
      // spacebar restarts when run is done
      if (ski && ski.done) { exitSki(); enterSki(); return; }
      skiInput();
    }
    if (e.key === "Escape" && skiActive) exitSki();
    if (e.key === "Escape" && revealActive) skipReveal();
  });

  window.addEventListener("resize", () => { layout(); if (skiActive) { /* keep skiing */ } else scheduleRender(); });
  window.FM = { render, enterSki, exitSki, startReveal, skipReveal, setTheme: (t) => { theme = t; document.body.className = "theme-" + t; render(); } };
  // boot — set up the view, then play the cinematic entrance once (slower, quieter than the Play replay)
  layout(); d3.select(canvas).call(zoom); fitView();
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) { render(); } else { const pb = document.getElementById("play"); if (pb) pb.textContent = "▶ Replay"; startReveal(true); }
})();
