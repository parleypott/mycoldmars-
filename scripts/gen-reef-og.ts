import { Resvg } from '@resvg/resvg-js';

// Reef OG share poster — 1200x630, on-brand with the live page itself.
// Palette + type lifted from public/reef/index.html:
//   pure black stage (#000), dark teal-black chrome, reef teal accent #2e6f6a /
//   bright teal #74b2ab, muted teal-grey text #5b6b6e / #8aa6a3, coral warm
//   accent (the kill-button glow) #e2664f, ui-monospace chrome. Dark cinematic
//   theme — the page is a full-bleed ambient flicker loop of baked Google-
//   satellite stills of coral atolls.
// Motif: a coral atoll seen from orbit — a bright reef ring around a darker
//   lagoon, wrapped in faint bathymetric depth contours, bleeding off the right
//   edge (echoing the wireframe-globe hub card), with a scatter of smaller
//   archipelago atolls. Deterministic (no Math.random) so it's headless/repro-safe.
// Truthful data: 120 frames across 60 named atolls (public/reef/frames/manifest.json).

const W = 1200, H = 630;
const TEAL = '#2e6f6a';
const TEAL_BRIGHT = '#74b2ab';
const TEAL_GLOW = '#3f9a8f';
const IVORY = '#eef4f2';
const DIM = '#8aa6a3';
const MUTE = '#5b6b6e';
const CORAL = '#e2664f';
const LAGOON = '#081d1c';

// One closed organic reef contour — a polar ring with layered sinusoidal wobble
// so it reads as a coral atoll traced from a satellite, not a clean circle.
function contour(cx: number, cy: number, baseR: number, wob: number, seed: number): string {
  const N = 176;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = baseR
      + wob * Math.sin(a * 3 + seed)
      + wob * 0.45 * Math.cos(a * 5 + seed * 1.7)
      + wob * 0.22 * Math.sin(a * 8 + seed * 0.6);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function ring(cx: number, cy: number, baseR: number, wob: number, seed: number, stroke: string, opacity: string, width: number): string {
  return `<polygon points="${contour(cx, cy, baseR, wob, seed)}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}"/>`;
}

// A full atoll: faint outer depth contours, a filled lagoon, and a bright reef ring.
function atoll(cx: number, cy: number, R: number, seed: number): string {
  return [
    ring(cx, cy, R * 1.34, R * 0.05, seed + 0.3, TEAL, '0.16', 1.4),
    ring(cx, cy, R * 1.16, R * 0.05, seed + 1.1, TEAL, '0.24', 1.6),
    `<polygon points="${contour(cx, cy, R * 0.9, R * 0.06, seed)}" fill="${LAGOON}" opacity="0.9"/>`,
    ring(cx, cy, R, R * 0.06, seed, TEAL_GLOW, '0.9', 3),
    ring(cx, cy, R * 0.9, R * 0.05, seed + 0.7, TEAL_BRIGHT, '0.5', 1.6),
  ].join('\n  ');
}

const corner = (x: number, y: number, t: string, anchor: string, fill: string, o = '1') =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="20" letter-spacing="4"
    fill="${fill}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${t}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="deep" cx="72%" cy="46%" r="78%">
      <stop offset="0%" stop-color="#0a1f1d"/>
      <stop offset="52%" stop-color="#050f0e"/>
      <stop offset="100%" stop-color="#000000"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#deep)"/>

  <!-- hero atoll, bleeding off the right edge -->
  ${atoll(1010, 315, 250, 0.4)}

  <!-- archipelago: smaller atolls scattered around the type-safe zone -->
  ${atoll(1180, 96, 70, 2.1)}
  ${atoll(1128, 560, 92, 4.7)}
  ${atoll(690, 512, 46, 3.3)}

  <!-- editorial frame -->
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="none" stroke="rgba(116,178,171,0.22)" stroke-width="2"/>

  <!-- corner meta frame, echoing the live page's mono chrome -->
  ${corner(64, 74, 'MYCOLDMARS', 'start', MUTE)}
  ${corner(W - 64, 74, 'CORAL · FROM ORBIT', 'end', TEAL_BRIGHT)}
  ${corner(64, H - 52, '120 FRAMES', 'start', MUTE, '0.9')}
  ${corner(W - 64, H - 52, '↗', 'end', TEAL_BRIGHT, '0.7')}

  <!-- kicker -->
  <text x="64" y="238" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="8"
    fill="${CORAL}" style="text-transform:uppercase">Satellite flicker loop</text>

  <!-- hero wordmark (lowercase, matching the page title) -->
  <text x="58" y="366" font-family="DejaVu Sans Mono" font-size="150" letter-spacing="2"
    fill="${IVORY}">reef</text>

  <!-- tagline -->
  <text x="64" y="426" font-family="DejaVu Sans Mono" font-size="27" letter-spacing="0.5"
    fill="${DIM}">60 coral atolls from orbit — a slow ambient loop.</text>
</svg>`;

const png = new Resvg(svg, { font: { loadSystemFonts: true }, fitTo: { mode: 'width', value: W }, background: '#000000' }).render().asPng();
const svgOut = new URL('../public/reef/og.svg', import.meta.url);
const pngOut = new URL('../public/reef/og.png', import.meta.url);
await Bun.write(svgOut, svg);
await Bun.write(pngOut, png);
console.log(`wrote ${pngOut.pathname} (${png.length} bytes, ${W}x${H})`);
