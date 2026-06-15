#!/usr/bin/env bun
/**
 * Bulk-inject the on-brand globe favicon into experiment pages that lack one.
 *
 * Many of the small experiment / toy pages (pinglobe, mapkeys, bounce, borders,
 * etc.) shipped without any <link rel="icon">, so their browser tabs fell back to
 * the default globe-less icon. The named tools (hunter, QSS, burma-script, …)
 * already carry favicons; this fills the gap for everyone else.
 *
 * `/favicon.svg` is served from the dist root (Vite copies public/ verbatim), so
 * an absolute href resolves correctly from any page depth. The link is inserted
 * once, immediately before the first </head>. Pages that already have an icon
 * link are skipped, so this is safe to re-run.
 *
 * Usage: bun scripts/inject-favicon.ts [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const LINK = '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n';
const ICON_RE = /rel=["']?(shortcut )?icon/i;

// All tracked index.html files, minus build output and deps.
const files = execSync('git ls-files "**/index.html" "index.html"', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  // Premiere extension panel runs inside Adobe, not served over the web —
  // an absolute /favicon.svg wouldn't resolve there, so it gains nothing.
  .filter((f) => !f.includes('premiere-extension'));

let changed = 0;
let skipped = 0;
for (const f of files) {
  const html = readFileSync(f, 'utf8');
  if (ICON_RE.test(html)) {
    skipped++;
    continue;
  }
  const idx = html.search(/<\/head>/i);
  if (idx === -1) {
    console.warn(`SKIP (no </head>): ${f}`);
    skipped++;
    continue;
  }
  const next = html.slice(0, idx) + LINK + html.slice(idx);
  if (!DRY) writeFileSync(f, next);
  console.log(`+ favicon: ${f}`);
  changed++;
}

console.log(`\n${DRY ? '[dry] would change' : 'changed'} ${changed}, skipped ${skipped} (already had icon)`);
