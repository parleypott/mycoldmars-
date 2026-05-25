#!/bin/bash
# Re-bake public/westchester/family-criteria.md into public/westchester/index.html
# as a <script type="text/plain" id="family-criteria-inline"> block.
#
# Why: Vercel's Attack Challenge Mode can 403 secondary fetches of static
# assets, breaking the agent's family-criteria.md load. By inlining the
# doctrine into the same response as the page, we eliminate the secondary
# request entirely.
#
# Run this after editing family-criteria.md, before committing.
# (Or wire it into a pre-commit hook later.)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDX="$ROOT/public/westchester/index.html"
CRIT="$ROOT/public/westchester/family-criteria.md"

node -e '
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const md = fs.readFileSync(process.argv[2], "utf8");
const safe = md.replace(/<\/script>/gi, "<\\/script>");
const open = "<script type=\"text/plain\" id=\"family-criteria-inline\">";
const close = "</script>";
const re = /<script type="text\/plain" id="family-criteria-inline">[\s\S]*?<\/script>/;
let out;
if (re.test(html)) {
  out = html.replace(re, open + safe + close);
} else {
  const anchor = "<script src=\"https://unpkg.com/maplibre-gl";
  const idx = html.indexOf(anchor);
  if (idx === -1) { console.error("anchor not found"); process.exit(1); }
  out = html.slice(0, idx) + open + safe + close + "\n" + html.slice(idx);
}
fs.writeFileSync(process.argv[1], out);
console.log("inlined doctrine:", md.length, "chars · index now:", out.length, "chars");
' "$IDX" "$CRIT"
