// Inject share metadata (description + canonical + Open Graph + Twitter card) into
// the public, in-sitemap story pages. Idempotent: skips a page that already has
// og:image; omits the description line if the page already has one.
// Each og:image points at the per-story poster from gen-story-og.ts.

type Meta = { slug: string; title: string; description: string; alt: string };

const STORIES: Meta[] = [
  {
    slug: 'night-market',
    title: 'Night Market — 夜市',
    description: 'A study-mode field guide to the Taiwan night market. Can you name all 30 dishes?',
    alt: 'Night Market — a Taiwan night market field guide',
  },
  {
    slug: 'hakka',
    title: 'Hakka — 客家',
    description: 'The Hakka people, their language, and their long migration — told through place.',
    alt: 'Hakka — the people, the language, the migration',
  },
  {
    slug: 'fascism',
    title: 'Fascism, Explained',
    description: 'How fascism actually works — explained plainly.',
    alt: 'Fascism, Explained — a plain-language explainer',
  },
  {
    slug: 'modern-middle-east',
    title: 'Modern Middle East',
    description: 'A whole region, made legible — maps, history, and the shape of power.',
    alt: 'Modern Middle East — a region made legible',
  },
  {
    slug: 'democracy',
    title: 'The V-Dem Sandbox — Democracy as Data',
    description: 'Play with the numbers behind every democracy. An interactive V-Dem sandbox.',
    alt: 'The V-Dem Sandbox — democracy as data',
  },
];

const BASE = 'https://mycoldmars.com';

function block(m: Meta, withDesc: boolean): string {
  const url = `${BASE}/${m.slug}/`;
  const img = `${url}og.png`;
  const lines: string[] = [];
  lines.push('  <!-- share metadata (injected by scripts/inject-story-meta.ts) -->');
  if (withDesc) lines.push(`  <meta name="description" content="${m.description}">`);
  lines.push(`  <link rel="canonical" href="${url}">`);
  lines.push(`  <meta property="og:type" content="website">`);
  lines.push(`  <meta property="og:site_name" content="my cold mars">`);
  lines.push(`  <meta property="og:title" content="${m.title}">`);
  lines.push(`  <meta property="og:description" content="${m.description}">`);
  lines.push(`  <meta property="og:url" content="${url}">`);
  lines.push(`  <meta property="og:image" content="${img}">`);
  lines.push(`  <meta property="og:image:width" content="1200">`);
  lines.push(`  <meta property="og:image:height" content="630">`);
  lines.push(`  <meta property="og:image:alt" content="${m.alt}">`);
  lines.push(`  <meta name="twitter:card" content="summary_large_image">`);
  lines.push(`  <meta name="twitter:title" content="${m.title}">`);
  lines.push(`  <meta name="twitter:description" content="${m.description}">`);
  lines.push(`  <meta name="twitter:image" content="${img}">`);
  return lines.join('\n') + '\n';
}

const dry = process.argv.includes('--dry');
let changed = 0, skipped = 0;

for (const m of STORIES) {
  const path = new URL(`../${m.slug}/index.html`, import.meta.url).pathname;
  const html = await Bun.file(path).text();
  if (html.includes('og:image')) {
    console.log(`skip  ${m.slug} (already has og:image)`);
    skipped++;
    continue;
  }
  const withDesc = !/name=["']description["']/.test(html);
  const inject = block(m, withDesc);
  const out = html.replace(/([ \t]*)<\/head>/, `${inject}$1</head>`);
  if (out === html) {
    console.log(`WARN  ${m.slug}: no </head> found, untouched`);
    continue;
  }
  console.log(`write ${m.slug}${withDesc ? '' : ' (desc exists, kept)'}`);
  if (!dry) await Bun.write(path, out);
  changed++;
}
console.log(`\n${dry ? '[dry] ' : ''}${changed} injected, ${skipped} skipped`);
