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
import { buildRouteToFile, routeToSourcePath } from './sitemap-source.mjs';

const DRY = process.argv.includes('--dry');
const BASE = 'https://mycoldmars.com';
const NOINDEX_RE = /name=["']?robots["']?[^>]*content=["'][^"']*noindex/i;

// Fallback <lastmod> for routes with no tracked source (build date, UTC day precision).
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// TRUTHFUL <lastmod>: the last git commit date touching a route's source path, so a
// page's lastmod reflects when it actually changed — not "today, every page, every run"
// (a uniform now-stamp trains crawlers to discount lastmod entirely). Falls back to the
// build date when the path is untracked or git is unavailable.
function gitLastmod(path: string | null): string {
  if (!path) return BUILD_DATE;
  try {
    const d = execSync(`git log -1 --format=%cs -- "${path}"`, { encoding: 'utf8' }).trim();
    return d || BUILD_DATE;
  } catch {
    return BUILD_DATE;
  }
}

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

// Resolve each route's TRUTHFUL lastmod from its ORIGINAL (pre-canonical) source path,
// then serve the canonical <loc>. noindex is checked on the served loc.
const routeToFile = buildRouteToFile(tracked);
const buildDated: string[] = [];
const entries = [...new Set([...navRoutes, ...EXTRA_ROUTES])]
  .map((r) => {
    const loc = CANONICAL[r] ?? r;
    const src = routeToSourcePath(r, routeToFile);
    if (!src) buildDated.push(loc);
    return { loc, lastmod: gitLastmod(src) };
  })
  .filter((e) => !noindex.has(e.loc))
  // Byte-for-byte with the previous default `.sort()` on the loc strings (ASCII, so
  // code-unit order == the sort we shipped before) — the URL SET/ORDER is unchanged.
  .sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));

const routes = entries.map((e) => e.loc);

const urls = entries
  .map(
    (e) =>
      `  <url>\n    <loc>${BASE}${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>`,
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
for (const e of entries) console.log(`  ${BASE}${e.loc}  (lastmod ${e.lastmod})`);
if (noindex.size) console.log(`excluded noindex routes: ${[...noindex].sort().join(', ')}`);
if (buildDated.length) console.log(`build-dated (no tracked source): ${buildDated.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(', ')}`);

if (!DRY) {
  writeFileSync('public/sitemap.xml', sitemap);
  writeFileSync('public/robots.txt', robots);
  console.log('\nwrote public/sitemap.xml + public/robots.txt');
} else {
  console.log('\n[dry] no files written');
}
