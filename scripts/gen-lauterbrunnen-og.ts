import { Resvg } from '@resvg/resvg-js';

// Lauterbrunnen OG share poster — 1200x630, on-brand with the live page itself.
// Palette + type lifted from public/lauterbrunnen/index.html:
//   paper #FFFFFF / #F5F3EF, ink #16140F, dim #7C766B / #A8A296, red accent #D42A1C,
//   Newsreader serif hero, IBM Plex Mono chrome. Light editorial theme (NOT the
//   dark burma card) — it's a clean printed adventure menu with a 3D mountain map.
// Motif: a layered alpine ridgeline rising to the Eiger–Mönch–Jungfrau wall, the
//   exact view every hike on the page points at.

const W = 1200, H = 630;
const PAPER = '#FFFFFF';
const PAPER2 = '#F5F3EF';
const LINE = '#E6E2D9';
const LINE2 = '#D7D2C7';
const INK = '#16140F';
const INK2 = '#4A453D';
const INK3 = '#7C766B';
const FAINT = '#A8A296';
const RED = '#D42A1C';

// Deterministic layered ridgeline (no Math.random — headless/repro-safe). Three
// receding ranges in cooling greys, then a near-black foreground spur, with three
// taller snow-capped peaks standing for the Eiger / Mönch / Jungfrau wall.
function ridge(baseY: number, amp: number, step: number, phase: number, fill: string, opacity = '1') {
  const pts: string[] = [`0,${H}`];
  let x = 0;
  let i = phase;
  while (x <= W) {
    const env = 0.55 + 0.45 * Math.sin(i * 0.55);
    const detail = 0.5 + 0.5 * Math.cos(i * 1.3);
    const y = baseY - (env * 0.7 + detail * 0.3) * amp;
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`);
    x += step;
    i += 1;
  }
  pts.push(`${W},${H}`);
  return `<polygon points="${pts.join(' ')}" fill="${fill}" opacity="${opacity}"/>`;
}

// The three big peaks — taller, sharper, with snow caps — across the right third,
// where the live page keeps the Eiger/Mönch/Jungfrau wall.
function peak(cx: number, baseY: number, height: number, halfW: number, fill: string, snow: string) {
  const apexY = baseY - height;
  const body = `<polygon points="${(cx - halfW).toFixed(0)},${baseY} ${cx},${apexY.toFixed(0)} ${(cx + halfW).toFixed(0)},${baseY}" fill="${fill}"/>`;
  // snow cap: small triangle off the apex
  const capH = height * 0.34;
  const capHalf = halfW * 0.34;
  const capBaseY = apexY + capH;
  const cap = `<polygon points="${(cx - capHalf).toFixed(0)},${capBaseY.toFixed(0)} ${cx},${apexY.toFixed(0)} ${(cx + capHalf).toFixed(0)},${capBaseY.toFixed(0)}" fill="${snow}"/>`;
  return body + '\n  ' + cap;
}

const corner = (x: number, y: number, t: string, anchor: string, fill: string, o = '1') =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="20" letter-spacing="4"
    fill="${fill}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${t}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>

  <!-- mountain scene clipped into the lower-right, behind the type -->
  <defs><clipPath id="frame"><rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18"/></clipPath></defs>
  <g clip-path="url(#frame)">
    <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="${PAPER}"/>
    ${ridge(560, 150, 26, 0.4, '#ECE9E3')}
    ${ridge(580, 200, 24, 2.1, '#E2DDD2', '0.95')}
    ${peak(900, 600, 300, 150, '#D7D2C7', PAPER2)}
    ${peak(1050, 600, 360, 160, '#CFC9BC', PAPER)}
    ${peak(770, 600, 250, 130, '#DCD7CB', PAPER2)}
    ${ridge(600, 120, 22, 4.7, '#16140F', '1')}
  </g>

  <!-- editorial frame -->
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="none" stroke="${LINE2}" stroke-width="2"/>

  <!-- corner meta frame, echoing the live page's mono chrome -->
  ${corner(64, 74, 'MYCOLDMARS', 'start', INK3)}
  ${corner(W - 64, 74, 'WENGEN · 1274M', 'end', RED)}
  ${corner(64, H - 52, '16 ADVENTURES', 'start', PAPER, '0.92')}
  ${corner(W - 64, H - 52, '↗', 'end', PAPER, '0.7')}

  <!-- kicker -->
  <text x="64" y="236" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="8"
    fill="${RED}" style="text-transform:uppercase">Bernese Oberland</text>

  <!-- hero serif wordmark -->
  <text x="58" y="350" font-family="DejaVu Serif" font-weight="bold" font-size="116"
    fill="${INK}">Lauterbrunnen</text>

  <!-- tagline -->
  <text x="64" y="412" font-family="DejaVu Serif" font-size="31"
    fill="${INK2}">An adventure menu for the valley. Home base: Wengen.</text>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: W }, background: PAPER }).render().asPng();
const out = new URL('../public/lauterbrunnen/og.png', import.meta.url);
await Bun.write(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes, ${W}x${H})`);
