import { Resvg } from '@resvg/resvg-js';

// Burma Essays OG share poster — 1200x630, on-brand with the PWA itself.
// Palette + type lifted from public/burma-essays/index.html:
//   bg #0e0e0c, ink #ece7dd, dim #9a9485, amber accent #e0a422, serif body / mono chrome.
// Motif: an amber audio waveform — it's a narration / listening app.

const W = 1200, H = 630;
const BG = '#0e0e0c';
const PANEL = '#16150f';
const LINE = '#2a2820';
const INK = '#ece7dd';
const DIM = 'rgba(154,148,133,0.92)';
const FAINT = 'rgba(106,101,90,0.85)';
const AMBER = '#e0a422';

// deterministic pseudo-waveform (no Math.random — headless/repro-safe)
const bars = 64;
const barW = 9;
const gap = 5;
const fieldW = bars * (barW + gap) - gap;
const x0 = (W - fieldW) / 2;
const baseY = 486;
const waveform = Array.from({ length: bars }, (_, i) => {
  // a couple of stacked sines → organic but stable amplitude envelope
  const t = i / bars;
  const env = 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI));            // swell in the middle
  const detail = 0.5 + 0.5 * Math.sin(i * 1.7) * Math.cos(i * 0.6);     // jitter
  const h = Math.max(6, env * detail * 96 + 8);
  const x = x0 + i * (barW + gap);
  const o = 0.45 + 0.55 * env;
  return `<rect x="${x.toFixed(1)}" y="${(baseY - h / 2).toFixed(1)}" width="${barW}" height="${h.toFixed(1)}" rx="2.5" fill="${AMBER}" opacity="${o.toFixed(2)}"/>`;
}).join('\n  ');

const corner = (x: number, y: number, t: string, anchor: string, fill: string, o = '1') =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="20" letter-spacing="4"
    fill="${fill}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${t}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="${PANEL}" stroke="${LINE}" stroke-width="2"/>

  <!-- corner meta frame, echoing the live reader -->
  ${corner(64, 74, 'MYCOLDMARS', 'start', DIM)}
  ${corner(W - 64, 74, 'LISTEN · LIBRARY', 'end', AMBER)}
  ${corner(64, H - 52, '2026', 'start', FAINT)}
  ${corner(W - 64, H - 52, '↗', 'end', DIM, '0.6')}

  <!-- kicker -->
  <text x="64" y="232" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="8"
    fill="${AMBER}" style="text-transform:uppercase">Burma</text>

  <!-- hero serif wordmark -->
  <text x="60" y="332" font-family="DejaVu Serif" font-weight="bold" font-size="120"
    fill="${INK}">Essays</text>

  <!-- tagline -->
  <text x="64" y="392" font-family="DejaVu Serif" font-size="32"
    fill="${INK}" opacity="0.9">Long-form audio essays. Put your phone down.</text>
  <text x="64" y="430" font-family="DejaVu Sans Mono" font-size="19" letter-spacing="0.5"
    fill="${DIM}">narrated &amp; offline-ready · a workshop by johnny harris</text>

  <!-- waveform motif -->
  <g>${waveform}</g>
</svg>`;

await Bun.write(new URL('../public/burma-essays/og.svg', import.meta.url).pathname, svg);
const png = new Resvg(svg, {
  font: { loadSystemFonts: true },
  fitTo: { mode: 'width', value: W },
}).render();
await Bun.write(new URL('../public/burma-essays/og.png', import.meta.url).pathname, png.asPng());
console.log(`wrote public/burma-essays/og.svg + og.png (${W}x${H})`);
