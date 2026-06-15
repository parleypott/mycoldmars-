import { Resvg } from '@resvg/resvg-js';

const W = 1200, H = 630;
const RED = '#d42e05';
const IVORY = '#faf7f2';
const IVORY_DIM = 'rgba(245,240,232,0.82)';
const IVORY_FAINT = 'rgba(245,240,232,0.20)';

// wireframe globe, bleeding off the right edge
const cx = 1010, cy = 315, r = 300;
const meridian = (rx: number, o: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${r}" stroke="${IVORY}" opacity="${o}"/>`;
const parallel = (dy: number, rx: number, o: number) =>
  `<ellipse cx="${cx}" cy="${cy + dy}" rx="${rx}" ry="${Math.max(8, rx * 0.16)}" stroke="${IVORY}" opacity="${o}"/>`;

const globe = `
  <g fill="none" stroke-width="2.4" stroke-linecap="round">
    <circle cx="${cx}" cy="${cy}" r="${r}" stroke="${IVORY}"/>
    ${meridian(r, 1)}
    ${meridian(r * 0.62, 0.7)}
    ${meridian(r * 0.22, 0.5)}
    <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${IVORY}"/>
    ${parallel(-r * 0.55, r * 0.83, 0.55)}
    ${parallel(r * 0.55, r * 0.83, 0.55)}
  </g>`;

const corner = (x: number, y: number, t: string, anchor: string, o: string) =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="4"
    fill="${IVORY}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${t}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="vig" cx="32%" cy="42%" r="85%">
      <stop offset="55%" stop-color="${RED}"/>
      <stop offset="100%" stop-color="#a82303"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
  ${globe}

  <!-- corner meta frame, echoing the live page -->
  ${corner(56, 64, 'MYCOLDMARS', 'start', '1')}
  ${corner(W - 56, 64, 'TOOLS', 'end', '1')}
  ${corner(56, H - 44, '2026', 'start', '1')}
  ${corner(W - 56, H - 44, '↗', 'end', '0.55')}

  <!-- hero wordmark + tagline -->
  <text x="88" y="332" font-family="DejaVu Sans Mono" font-size="108" letter-spacing="2"
    fill="${IVORY}">mycoldmars</text>
  <rect x="92" y="372" width="86" height="3" fill="${IVORY}" opacity="0.85"/>
  <text x="92" y="424" font-family="DejaVu Sans Mono" font-size="27" letter-spacing="0.5"
    fill="${IVORY_DIM}">tools, toys &amp; experiments</text>
  <text x="92" y="462" font-family="DejaVu Sans Mono" font-size="27" letter-spacing="0.5"
    fill="${IVORY_DIM}">a workshop by johnny harris</text>
</svg>`;

await Bun.write('og.svg', svg);
const png = new Resvg(svg, { font: { loadSystemFonts: true }, fitTo: { mode: 'width', value: 1200 } }).render();
await Bun.write('og.png', png.asPng());
console.log('rendered', png.width, 'x', png.height);
