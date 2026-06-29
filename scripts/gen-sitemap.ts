#!/usr/bin/env bun
/**
 * Generate robots.txt + sitemap.xml for the public mycoldmars surface.
 *
 * The hub (index.html) carries a curated dots-nav — that nav IS the public site
 * map, so we derive the sitemap from it rather than from the full ~50-page Vite
 * input list (most of which are private toys / WIP). A few real projects live at
 * their own routes but aren't on the hub nav (burma-essays, walden); those are
 * added explicitly via EXTRA_ROUTES.
 *
 * Gated / noindex tools (hunter, translation, burma-script, westchester,
 * pinglobe-feedback) are auto-excluded: we scan every tracked index.html for a
 * `robots ... noindex` meta and drop the matching route, so a page going noindex
 * later drops out of the sitemap on the next run without editing this file.
 *
 * Both files land in public/, which Vite copies verbatim to the dist root, so
 * they serve at https://mycoldmars.com/{robots.txt,sitemap.xml}.
 *
 * Usage: bun scripts/gen-sitemap.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const BASE = 'https://mycoldmars.com';
const NOINDEX_RE = /name=["']?robots["']?[^>]*content=["'][^"']*noindex/i;

// ISO date (UTC, day precision) for <lastmod>.
const lastmod = new Date().toISOString().slice(0, 10);

// Map a tracked index.html path to its served route.
//   hunter/index.html         -> /hunter/
//   public/westchester/...    -> /westchester/   (public/ is the dist root)
//   index.html                -> /
function fileToRoute(file: string): string {
  let r = file.replace(/^public\//, '').replace(/index\.html$/, '');
  if (!r.startsWith('/')) r = '/' + r;
  if (r === '/') return '/';
  return r.endsWith('/') ? r : r + '/';
}

// Routes whose source page is noindex — excluded from the sitemap.
const tracked = execSync('git ls-files "**/index.html" "index.html"', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);
const noindex = new Set<string>();
for (const f of tracked) {
  if (NOINDEX_RE.test(readFileSync(f, 'utf8'))) noindex.add(fileToRoute(f));
}

// Curated public routes from the hub's own nav.
const hub = readFileSync('index.html', 'utf8');
const navRoutes = [...hub.matchAll(/href="(\/[^"#]*)"/g)]
  .map((m) => m[1])
  .filter((h) => !/\.(svg|png|jpg|jpeg|ico|webp|xml|txt)$/i.test(h)) // assets, not pages
  .map((h) => (h.endsWith('/') ? h : h + '/'));

// Real public projects that aren't on the hub nav.
const EXTRA_ROUTES = ['/', '/burma-essays/', '/lauterbrunnen/', '/walden/'];

// Some nav routes 302-redirect to a canonical destination (see vercel.json) —
// list the resolved URL so crawlers index the real page, not the redirect.
const CANONICAL: Record<string, string> = {
  '/queen-scarlet-school/': '/universe/queen-scarlet/write/',
};

const routes = [...new Set([...navRoutes, ...EXTRA_ROUTES])]
  .map((r) => CANONICAL[r] ?? r)
  .filter((r) => !noindex.has(r))
  .sort();

const urls = routes
  .map(
    (r) =>
      `  <url>\n    <loc>${BASE}${r}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
  )
  .join('\n');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

const robots = `# mycoldmars
User-agent: *
Allow: /

# Gated / work-in-progress tools (also noindex'd per-page)
Disallow: /hunter/
Disallow: /translation/
Disallow: /burma-script/
Disallow: /westchester/
Disallow: /pinglobe-feedback/

Sitemap: ${BASE}/sitemap.xml
`;

console.log(`routes in sitemap (${routes.length}):`);
for (const r of routes) console.log(`  ${BASE}${r}`);
if (noindex.size) console.log(`excluded noindex routes: ${[...noindex].sort().join(', ')}`);

if (!DRY) {
  writeFileSync('public/sitemap.xml', sitemap);
  writeFileSync('public/robots.txt', robots);
  console.log('\nwrote public/sitemap.xml + public/robots.txt');
} else {
  console.log('\n[dry] no files written');
}
