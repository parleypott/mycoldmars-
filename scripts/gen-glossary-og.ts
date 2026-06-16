import { Resvg } from '@resvg/resvg-js';
import { mkdirSync } from 'node:fs';

// Glossary OG share poster — 1200x630, art-directed to the taste-library's own
// identity (warm wall + cream + soul-orange + aged-gold). Deterministic, no raster
// inputs (DejaVu fonts on the box) so it's repro-safe headless. Signature motif:
// a row of palette swatches — the page is literally a menu of palettes.

const W = 1200, H = 630;

const C = {
  wall: '#1d1916', panel: '#241f1a', line: '#3a322a',
  cream: '#efe3cc', dim: 'rgba(216,205,185,0.92)', mut: 'rgba(154,143,126,0.85)',
  accent: '#c9532d', gold: '#d6a23e',
};

// the swatch strip — one column per tradition palette on the page, condensed
const PALETTES: string[][] = [
  ['#e4002b', '#ffd400', '#005bbb'],           // Bauhaus
  ['#6e241c', '#c9532d', '#d6a23e'],           // 70s Soul (key)
  ['#3a241c', '#c4622e', '#caa14e'],           // New Hollywood (key)
  ['#0e3b3a', '#c4622e', '#d99a3c'],           // Soul Cinema (key)
  ['#ff2e88', '#ff8a00', '#7b2ff7'],           // Psychedelic
  ['#bc002d', '#1a1a1a', '#f7f4ee'],           // Japanese Editorial
  ['#ff4f00', '#0077ff', '#ffd400'],           // Riso
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function corner(x: number, y: number, t: string, anchor: string, fill: string, o = '1') {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="20" letter-spacing="4"
    fill="${fill}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${esc(t)}</text>`;
}

// palette strip parked upper-right as the brand mark for "a menu of palettes",
// clear of the title (lower-left) and tagline (lower band)
function swatchStrip(): string {
  const cols = PALETTES.length;
  const cw = 54, gap = 12;
  const stripW = cols * cw + (cols - 1) * gap;
  const x0 = W - 64 - stripW;
  const y0 = 120;
  const ch = 44;
  let out = '';
  PALETTES.forEach((pal, ci) => {
    const x = x0 + ci * (cw + gap);
    pal.forEach((hex, ri) => {
      const y = y0 + ri * ch;
      out += `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${hex}"/>`;
    });
    out += `<rect x="${x}" y="${y0}" width="${cw}" height="${ch * pal.length}" fill="none"
      stroke="${C.wall}" stroke-width="2"/>`;
  });
  return out;
}

function render(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.wall}"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="${C.panel}" stroke="${C.line}" stroke-width="2"/>

  ${swatchStrip()}

  ${corner(64, 74, 'MYCOLDMARS', 'start', C.dim)}
  ${corner(W - 64, 74, 'TASTE LIBRARY', 'end', C.gold)}
  ${corner(64, H - 52, '2026', 'start', C.mut)}
  ${corner(W - 64, H - 52, '↗', 'end', C.dim, '0.6')}

  <text x="64" y="176" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="7"
    fill="${C.accent}" style="text-transform:uppercase">A walk through design history</text>

  <text x="60" y="300" font-family="DejaVu Serif" font-size="120" fill="${C.cream}">The</text>
  <text x="60" y="416" font-family="DejaVu Serif" font-style="italic" font-size="120"
    fill="${C.gold}">Glossary</text>

  <rect x="66" y="452" width="86" height="5" rx="2.5" fill="${C.accent}"/>

  <text x="64" y="512" font-family="DejaVu Serif" font-size="33" fill="${C.cream}" opacity="0.92">Browse the traditions. Crown the ones we love.</text>
  <text x="64" y="552" font-family="DejaVu Sans Mono" font-size="19" letter-spacing="0.5"
    fill="${C.dim}">locked, invokable taste profiles · mycoldmars</text>
</svg>`;
}

const svg = render();
const dir = new URL('../public/glossary/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
await Bun.write(`${dir}og.svg`, svg);
const png = new Resvg(svg, {
  font: { loadSystemFonts: true },
  fitTo: { mode: 'width', value: W },
}).render();
await Bun.write(`${dir}og.png`, png.asPng());
console.log(`wrote public/glossary/og.svg + og.png (${W}x${H})`);
