#!/bin/bash
# Re-bake static assets into public/westchester/index.html so the page renders
# fully from a single HTTP response — no secondary fetches that can be eaten by
# Vercel Attack Challenge Mode, stale CDNs, browser extensions, or bot filters.
#
# Currently bakes:
#   - family-criteria.md → <script type="text/plain" id="family-criteria-inline">
#   - photos/manifest.json → <script type="application/json" id="photo-manifest-inline">
#
# Run this whenever family-criteria.md OR the photo manifest changes, then commit.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDX="$ROOT/public/westchester/index.html"
CRIT="$ROOT/public/westchester/family-criteria.md"
MANIFEST="$ROOT/public/westchester/photos/manifest.json"

node -e '
const fs = require("fs");
let html = fs.readFileSync(process.argv[1], "utf8");
const md = fs.readFileSync(process.argv[2], "utf8");
const manifest = fs.existsSync(process.argv[3]) ? fs.readFileSync(process.argv[3], "utf8") : "{}";

function inlineBlock(html, tagOpen, content, anchor) {
  const open = tagOpen;
  const close = "</script>";
  const safe = String(content).replace(/<\/script>/gi, "<\\/script>");
  const re = new RegExp(open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?</script>");
  if (re.test(html)) {
    return html.replace(re, open + safe + close);
  }
  const idx = html.indexOf(anchor);
  if (idx === -1) throw new Error("anchor not found: " + anchor);
  return html.slice(0, idx) + open + safe + close + "\n" + html.slice(idx);
}

const anchor = "<script src=\"https://unpkg.com/maplibre-gl";
html = inlineBlock(html, "<script type=\"text/plain\" id=\"family-criteria-inline\">", md, anchor);
html = inlineBlock(html, "<script type=\"application/json\" id=\"photo-manifest-inline\">", manifest, anchor);

fs.writeFileSync(process.argv[1], html);
console.log("baked: family-criteria.md (" + md.length + " chars) + photo-manifest (" + manifest.length + " chars)");
console.log("index now: " + html.length + " chars");
' "$IDX" "$CRIT" "$MANIFEST"
