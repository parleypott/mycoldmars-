/**
 * Pure route -> source-path resolution for the sitemap generator.
 *
 * Extracted from gen-sitemap.ts so the mapping is unit-testable without shelling
 * out to git. gen-sitemap.ts feeds each resolved path to `git log -1 --format=%cs`
 * to stamp a TRUTHFUL <lastmod> (the page's real last-commit date) instead of the
 * old "today, every page, every run" stamp that trains crawlers to ignore lastmod.
 */
import { dirname } from 'node:path';

// Map a tracked index.html path to its served route (mirror of gen-sitemap.ts).
//   index.html                 -> /
//   animatedcrazy/index.html   -> /animatedcrazy/
//   public/walden/index.html   -> /walden/   (public/ is the dist root)
export function fileToRoute(file) {
  let r = file.replace(/^public\//, '').replace(/index\.html$/, '');
  if (!r.startsWith('/')) r = '/' + r;
  if (r === '/') return '/';
  return r.endsWith('/') ? r : r + '/';
}

// Invert fileToRoute over the tracked index.html list: route -> source file.
export function buildRouteToFile(trackedFiles) {
  const m = new Map();
  for (const f of trackedFiles) {
    const t = String(f || '').trim();
    if (t) m.set(fileToRoute(t), t);
  }
  return m;
}

// The path `git log` should blame for a route's <lastmod>. A page is its whole
// directory (HTML + JS + CSS + assets), so we blame the directory — a JS-only
// change still moves lastmod. The root hub blames index.html alone (blaming '.'
// would make EVERY commit bump the homepage). Returns null when no tracked source
// backs the route, so the caller falls back to the build date.
//
// IMPORTANT: pass the ORIGINAL (pre-canonical-redirect) route here. A route that
// 302s to a canonical destination is authored at its original path's index.html;
// the canonical URL is a Vite-built route with no tracked source of its own.
export function routeToSourcePath(route, routeToFile) {
  const file = routeToFile.get(route);
  if (!file) return null;
  const dir = dirname(file); // 'index.html' -> '.'
  return dir === '.' ? file : dir + '/';
}
