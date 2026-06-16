import { Resvg } from '@resvg/resvg-js';
import { mkdirSync } from 'node:fs';

// Story OG share posters — 1200x630, one per public in-sitemap story page.
// Typographic posters (no raster assets) so they're deterministic + repro-safe.
// Latin: DejaVu Serif/Sans/Mono. CJK: WenQuanYi Zen Hei (present on the box).
// Each card is art-directed to the story's own identity — not a generic template.

const W = 1200, H = 630;

type Story = {
  slug: string;
  light?: boolean;
  bg: string; panel: string; line: string;
  ink: string; dim: string; faint: string; accent: string;
  kicker: string;
  cjk?: string;             // optional big CJK glyph block (left)
  title: string[];          // hero title lines
  serif: boolean;           // serif vs sans for the hero
  tagline: string;
  meta: string;             // mono note under tagline
  section: string;          // top-right corner label
};

const STORIES: Story[] = [
  {
    slug: 'night-market',
    bg: '#160d14', panel: '#1e1019', line: '#3a2433',
    ink: '#f4eadd', dim: 'rgba(214,196,178,0.9)', faint: 'rgba(150,120,135,0.8)',
    accent: '#ff8a3d',
    kicker: 'Taiwan', cjk: '夜市',
    title: ['Night', 'Market'], serif: true,
    tagline: 'Can you name all 30 dishes?',
    meta: 'a study-mode field guide · mycoldmars',
    section: 'STUDY · 30 DISHES',
  },
  {
    slug: 'hakka',
    bg: '#1a1410', panel: '#22190f', line: '#3d2f1d',
    ink: '#efe6d6', dim: 'rgba(206,190,166,0.9)', faint: 'rgba(150,128,96,0.82)',
    accent: '#d98a3d',
    kicker: 'A People', cjk: '客家',
    title: ['Hakka'], serif: true,
    tagline: 'The people, the language, the long migration.',
    meta: 'culture · history · place · mycoldmars',
    section: 'CULTURE',
  },
  {
    slug: 'fascism',
    bg: '#0b0b0c', panel: '#121214', line: '#272729',
    ink: '#f2efe9', dim: 'rgba(196,194,188,0.9)', faint: 'rgba(120,118,112,0.82)',
    accent: '#e3261c',
    kicker: 'How power turns',
    title: ['Fascism', 'Explained'], serif: false,
    tagline: 'How it actually works — plainly.',
    meta: 'an explainer · mycoldmars',
    section: 'EXPLAINER',
  },
  {
    slug: 'modern-middle-east',
    bg: '#15120b', panel: '#1d1810', line: '#36301f',
    ink: '#f0e9da', dim: 'rgba(208,196,170,0.9)', faint: 'rgba(150,134,98,0.82)',
    accent: '#d9a441',
    kicker: 'The whole region',
    title: ['Modern', 'Middle East'], serif: false,
    tagline: 'A whole region, made legible.',
    meta: 'maps · history · power · mycoldmars',
    section: 'EXPLAINER',
  },
  {
    slug: 'democracy',
    light: true,
    bg: '#FFF6E0', panel: '#FFFAEC', line: '#F0DFB2',
    ink: '#1F1F23', dim: 'rgba(53,53,64,0.92)', faint: 'rgba(107,107,122,0.85)',
    accent: '#E84545',
    kicker: 'The V-Dem Sandbox',
    title: ['Democracy,', 'as Data'], serif: true,
    tagline: 'Play with the numbers behind every democracy.',
    meta: 'an interactive sandbox · mycoldmars',
    section: 'SANDBOX',
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function corner(x: number, y: number, t: string, anchor: string, fill: string, o = '1') {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans Mono" font-size="20" letter-spacing="4"
    fill="${fill}" opacity="${o}" text-anchor="${anchor}"
    style="text-transform:uppercase">${esc(t)}</text>`;
}

function render(s: Story): string {
  const heroFont = s.serif ? 'DejaVu Serif' : 'DejaVu Sans';
  const heroWeight = s.serif ? 'normal' : 'bold';
  const lineH = 118;
  const titleTop = 286;   // fixed first-baseline; lines flow downward, clears the kicker
  const titleSvg = s.title.map((ln, i) =>
    `<text x="64" y="${titleTop + i * lineH}" font-family="${heroFont}" font-weight="${heroWeight}"
      font-size="108" fill="${s.ink}" ${s.serif ? '' : 'letter-spacing="-1"'}>${esc(ln)}</text>`
  ).join('\n  ');

  // optional big CJK glyph, parked on the right as a watermark-scale brand mark
  const cjkSvg = s.cjk
    ? `<text x="${W - 70}" y="${H - 96}" font-family="WenQuanYi Zen Hei" font-size="360"
        fill="${s.accent}" opacity="0.14" text-anchor="end">${esc(s.cjk)}</text>
       <text x="${W - 80}" y="232" font-family="WenQuanYi Zen Hei" font-size="92"
        fill="${s.accent}" text-anchor="end">${esc(s.cjk)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${s.bg}"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="18" fill="${s.panel}" stroke="${s.line}" stroke-width="2"/>

  ${cjkSvg}

  ${corner(64, 74, 'MYCOLDMARS', 'start', s.dim)}
  ${corner(W - 64, 74, s.section, 'end', s.accent)}
  ${corner(64, H - 52, '2026', 'start', s.faint)}
  ${corner(W - 64, H - 52, '↗', 'end', s.dim, '0.6')}

  <text x="64" y="172" font-family="DejaVu Sans Mono" font-size="22" letter-spacing="7"
    fill="${s.accent}" style="text-transform:uppercase">${esc(s.kicker)}</text>

  ${titleSvg}

  <rect x="66" y="${titleTop + (s.title.length - 1) * lineH + 36}" width="86" height="5" rx="2.5" fill="${s.accent}"/>

  <text x="64" y="${titleTop + (s.title.length - 1) * lineH + 92}" font-family="DejaVu Serif"
    font-size="33" fill="${s.ink}" opacity="0.92">${esc(s.tagline)}</text>
  <text x="64" y="${titleTop + (s.title.length - 1) * lineH + 134}" font-family="DejaVu Sans Mono"
    font-size="19" letter-spacing="0.5" fill="${s.dim}">${esc(s.meta)}</text>
</svg>`;
}

for (const s of STORIES) {
  const svg = render(s);
  const dir = new URL(`../public/${s.slug}/`, import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  await Bun.write(`${dir}og.svg`, svg);
  const png = new Resvg(svg, {
    font: { loadSystemFonts: true },
    fitTo: { mode: 'width', value: W },
  }).render();
  await Bun.write(`${dir}og.png`, png.asPng());
  console.log(`wrote public/${s.slug}/og.svg + og.png (${W}x${H})`);
}
console.log(`done — ${STORIES.length} story posters`);
