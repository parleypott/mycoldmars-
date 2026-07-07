/* Landmark ladders + elegant vector silhouettes.
 *
 * HEIGHT ladder: height = vertical climb from the object's OWN base ("base camp")
 * per Johnny — a building = its real height; a mountain = base-to-summit.
 * DISTANCE ladder: famous distances, for the mileage view.
 *
 * Silhouettes are clean SOLID pictograms (Otl-Aicher-ish), drawn parametrically
 * into a unit box so they stay razor-crisp at any zoom. One fill color, balanced
 * negative space, consistent weight — no fussy detail.
 */
window.LANDMARKS = [
  { name: "Statue of Liberty", h: 93,  shape: "liberty",  note: "ground to torch" },
  { name: "Big Ben",           h: 96,  shape: "bigben" },
  { name: "Saturn V",          h: 111, shape: "rocket" },
  { name: "Great Pyramid",     h: 139, shape: "pyramid" },
  { name: "Washington Mon.",   h: 169, shape: "obelisk" },
  { name: "Golden Gate",       h: 227, shape: "bridge" },
  { name: "Eiffel Tower",      h: 330, shape: "eiffel" },
  { name: "Empire State",      h: 443, shape: "empire" },
  { name: "One World Trade",   h: 541, shape: "wtc" },
  { name: "Burj Khalifa",      h: 828, shape: "burj" },
  { name: "El Capitan",        h: 900,  shape: "cliff", prov: true },
  { name: "Half Dome",         h: 1444, shape: "dome",  prov: true, note: "from valley" },
];

window.DIST_LANDMARKS = [
  { name: "Track lap",        d: 400 },
  { name: "1 mile",           d: 1609 },
  { name: "Golden Gate Br.",  d: 2737 },
  { name: "5K race",          d: 5000 },
  { name: "10K race",         d: 10000 },
  { name: "Half marathon",    d: 21097 },
  { name: "Manhattan length", d: 21600 },
  { name: "Marathon",         d: 42195 },
];

const ASPECT = {
  pyramid: 1.45, obelisk: 0.13, eiffel: 0.66, rocket: 0.24, liberty: 0.46,
  bigben: 0.26, empire: 0.40, wtc: 0.30, burj: 0.30, bridge: 1.25, cliff: 1.25, dome: 1.7,
};

window.landmarkAspect = (s) => ASPECT[s] || 0.4;

window.drawLandmark = function (ctx, shape, cx, baseY, pxH, color, maxW) {
  let w = pxH * (ASPECT[shape] || 0.4);
  if (maxW && w > maxW) w = maxW;
  const hw = w / 2, T = baseY - pxH;
  const yAt = (f) => baseY - pxH * f;     // f: 0 base → 1 top
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fill(); };

  switch (shape) {
    case "pyramid":
      poly([[cx - hw, baseY], [cx, T], [cx + hw, baseY]]);
      break;

    case "obelisk": {
      const sw = w, cap = pxH * 0.055, taper = sw * 0.18;
      poly([[cx - sw / 2, baseY], [cx - sw / 2 + taper * 0.2, yAt(0.94)],
        [cx - sw / 2 + taper, yAt(1) ], [cx - 0, T], [cx + sw / 2 - taper, yAt(1)],
        [cx + sw / 2 - taper * 0.2, yAt(0.94)], [cx + sw / 2, baseY]]);
      // clean pyramidion notch line
      break;
    }

    case "eiffel": {
      // solid concave-flared tower → unmistakable Eiffel
      ctx.beginPath();
      ctx.moveTo(cx - hw, baseY);
      ctx.quadraticCurveTo(cx - hw * 0.34, yAt(0.5), cx - w * 0.045, T);
      ctx.lineTo(cx + w * 0.045, T);
      ctx.quadraticCurveTo(cx + hw * 0.34, yAt(0.5), cx + hw, baseY);
      ctx.closePath(); ctx.fill();
      // first-platform bar (defining horizontal)
      ctx.fillRect(cx - hw * 0.62, yAt(0.27) - pxH * 0.012, hw * 1.24, pxH * 0.024);
      break;
    }

    case "rocket": {
      const bw = w * 0.6, noseH = pxH * 0.2;
      poly([[cx - bw / 2, baseY], [cx - bw / 2, yAt(0.8)], [cx, T],
        [cx + bw / 2, yAt(0.8)], [cx + bw / 2, baseY]]);
      // slim fins
      poly([[cx - bw / 2, baseY], [cx - hw, baseY], [cx - bw / 2, yAt(0.13)]]);
      poly([[cx + bw / 2, baseY], [cx + hw, baseY], [cx + bw / 2, yAt(0.13)]]);
      break;
    }

    case "liberty": {
      const bw = w * 0.62;
      // robe
      poly([[cx - bw / 2, baseY], [cx - bw * 0.18, yAt(0.6)], [cx + bw * 0.18, yAt(0.6)], [cx + bw / 2, baseY]]);
      // head
      ctx.beginPath(); ctx.arc(cx, yAt(0.66), w * 0.1, 0, 7); ctx.fill();
      // crown rays
      for (let i = -2; i <= 2; i++) {
        const a = -Math.PI / 2 + i * 0.42;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * w * 0.1, yAt(0.66) + Math.sin(a) * w * 0.1);
        ctx.lineTo(cx + Math.cos(a) * w * 0.2, yAt(0.66) + Math.sin(a) * w * 0.2);
        ctx.lineWidth = Math.max(1, w * 0.05); ctx.stroke();
      }
      // raised arm + torch
      ctx.lineWidth = Math.max(1.4, w * 0.09);
      ctx.beginPath(); ctx.moveTo(cx + bw * 0.08, yAt(0.58)); ctx.lineTo(cx + w * 0.2, yAt(0.92)); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx + w * 0.2, T + pxH * 0.05, w * 0.07, 0, 7); ctx.fill();
      break;
    }

    case "bigben": {
      const tw = w * 0.72;
      poly([[cx - tw / 2, baseY], [cx - tw / 2, yAt(0.8)], [cx, T], [cx + tw / 2, yAt(0.8)], [cx + tw / 2, baseY]]);
      // clock face as a cut (paper-tone dot via lighter alpha ring)
      ctx.save(); ctx.globalAlpha = 0.0; ctx.restore();
      break;
    }

    case "empire": {
      // 3 clean setbacks + needle
      const w1 = w, w2 = w * 0.62, w3 = w * 0.3;
      ctx.beginPath();
      ctx.rect(cx - w1 / 2, yAt(0.42), w1, pxH * 0.42 + 1);
      ctx.rect(cx - w2 / 2, yAt(0.8), w2, pxH * 0.4);
      ctx.rect(cx - w3 / 2, yAt(0.92), w3, pxH * 0.14);
      ctx.fill();
      ctx.fillRect(cx - Math.max(0.6, w * 0.02), yAt(1), Math.max(1.2, w * 0.04), pxH * 0.08); // needle
      break;
    }

    case "wtc": {
      // tapered prism + spire
      poly([[cx - hw, baseY], [cx - w * 0.18, yAt(0.93)], [cx + w * 0.18, yAt(0.93)], [cx + hw, baseY]]);
      ctx.fillRect(cx - Math.max(0.6, w * 0.02), yAt(1), Math.max(1.2, w * 0.04), pxH * 0.1);
      break;
    }

    case "burj": {
      ctx.beginPath();
      ctx.moveTo(cx - hw, baseY);
      ctx.lineTo(cx - w * 0.22, yAt(0.5));
      ctx.lineTo(cx - w * 0.08, yAt(0.82));
      ctx.lineTo(cx, T);
      ctx.lineTo(cx + w * 0.08, yAt(0.82));
      ctx.lineTo(cx + w * 0.22, yAt(0.5));
      ctx.lineTo(cx + hw, baseY);
      ctx.closePath(); ctx.fill();
      break;
    }

    case "bridge": {
      // two towers + suspension cable + deck — solid, elegant
      const tx = w * 0.32, tw = Math.max(1.5, w * 0.05), deckY = yAt(0.32);
      ctx.fillRect(cx - tx - tw / 2, T, tw, pxH);
      ctx.fillRect(cx + tx - tw / 2, T, tw, pxH);
      ctx.lineWidth = Math.max(1.4, w * 0.035);
      ctx.beginPath(); // main cable swoop
      ctx.moveTo(cx - hw, deckY);
      ctx.quadraticCurveTo(cx - tx, T, cx, T + pxH * 0.12);
      ctx.quadraticCurveTo(cx + tx, T, cx + hw, deckY);
      ctx.stroke();
      ctx.fillRect(cx - hw, deckY, w, Math.max(1.4, pxH * 0.03)); // deck
      break;
    }

    case "cliff":
      poly([[cx - hw, baseY], [cx - hw * 0.7, yAt(0.45)], [cx - hw * 0.2, yAt(0.96)],
        [cx + hw * 0.2, T], [cx + hw, yAt(0.25)], [cx + hw, baseY]]);
      break;

    case "dome":
      ctx.beginPath();
      ctx.moveTo(cx - hw, baseY);
      ctx.lineTo(cx - hw * 0.5, yAt(0.5));
      ctx.quadraticCurveTo(cx - hw * 0.1, T, cx + hw * 0.45, yAt(0.92));
      ctx.lineTo(cx + hw, yAt(0.55));
      ctx.lineTo(cx + hw, baseY);
      ctx.closePath(); ctx.fill();
      break;

    default:
      ctx.fillRect(cx - hw * 0.6, T, w * 0.6, pxH);
  }
  ctx.restore();
};
