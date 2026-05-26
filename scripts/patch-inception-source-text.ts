#!/usr/bin/env bun
// Quick patch — fixes existing inception stories in DB so they display correctly
// without regenerating any images. Sets source_text on each cue and sets
// __sceneBreaksScanned so the browser won't overwrite cues on open.
//
// Run: bun run scripts/patch-inception-source-text.ts

import { readFileSync } from "fs";
import * as path from "path";

function loadEnv() {
  const files = [
    path.join(import.meta.dir, "../.env.local"),
    path.join(import.meta.dir, "../.env"),
    `${process.env.HOME}/.config/mycoldmars/secrets.env`,
  ];
  for (const f of files) {
    try {
      for (const line of readFileSync(f, "utf8").split("\n")) {
        const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
      }
    } catch {}
  }
}
loadEnv();

const SUPABASE_URL = process.env.HENRY_UNIVERSE_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.HENRY_UNIVERSE_SUPABASE_SERVICE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("❌ Missing HENRY_UNIVERSE_SUPABASE creds"); process.exit(1); }

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function sb(method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${urlPath}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`sb_${res.status}: ${t.slice(0, 400)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : null;
}

interface Cue {
  id: string;
  offset?: number;
  label?: string;
  auto?: boolean;
  source_text?: string;
  variations?: unknown[];
  active_variation_id?: string | null;
  image?: { url?: string; mimeType?: string } | null;
  [k: string]: unknown;
}

interface Block {
  id: string;
  text?: string;
  __cues?: Cue[];
  __sceneBreaksScanned?: string;
  [k: string]: unknown;
}

interface Story {
  id: string;
  name: string;
  blocks?: Block[];
  rules?: Record<string, unknown>;
}

async function main() {
  console.log("🔧 Patching inception stories — source_text + __sceneBreaksScanned\n");

  // Fetch all stories that have inception: true in rules
  const stories = await sb(
    "GET",
    `qss_stories?select=id,name,blocks,rules&deleted_at=is.null&limit=50`
  ) as Story[];

  const inceptions = stories.filter(s => s.rules?.inception === true);
  console.log(`Found ${inceptions.length} inception stories\n`);

  let patched = 0;
  let skipped = 0;

  for (const story of inceptions) {
    const blocks: Block[] = Array.isArray(story.blocks) ? story.blocks : [];
    let changed = false;

    for (const b of blocks) {
      const text = b.text || "";
      if (!text || !Array.isArray(b.__cues) || b.__cues.length === 0) continue;

      // Sort cues by offset
      b.__cues.sort((a, c) => (a.offset || 0) - (c.offset || 0));

      // Assign source_text to every cue that's missing it
      let cuePatchCount = 0;
      for (let i = 0; i < b.__cues.length; i++) {
        const cue = b.__cues[i];
        const nextOffset = b.__cues[i + 1]?.offset ?? text.length;
        const slice = text.slice(cue.offset || 0, nextOffset);
        if (!cue.source_text || cue.source_text === text) {
          cue.source_text = slice;
          cuePatchCount++;
          changed = true;
        }
        // Migrate image → variations if needed
        if (!Array.isArray(cue.variations)) cue.variations = [];
        if (cue.variations.length === 0 && cue.image && (cue.image as { url?: string }).url) {
          const im = cue.image as { url: string; mimeType?: string };
          const varId = `v-${Date.now().toString(36)}-${i}`;
          cue.variations.push({ id: varId, url: im.url, mimeType: im.mimeType || "image/png", created_at: Date.now() });
          cue.active_variation_id = varId;
          changed = true;
        }
      }

      // Set __sceneBreaksScanned so the browser won't re-detect on open
      const fp = `${text.length}:${hashString(text)}`;
      if (b.__sceneBreaksScanned !== fp) {
        b.__sceneBreaksScanned = fp;
        changed = true;
      }

      if (cuePatchCount > 0) {
        console.log(`  "${story.name}": patched source_text on ${cuePatchCount} cue(s)`);
      }
    }

    if (changed) {
      try {
        await sb("PATCH", `qss_stories?id=eq.${story.id}`, {
          blocks,
          updated_at: new Date().toISOString(),
        });
        console.log(`  ✓ "${story.name}" saved`);
        patched++;
      } catch (e) {
        console.error(`  ✗ "${story.name}" save failed: ${e}`);
      }
    } else {
      console.log(`  — "${story.name}" already clean, skipping`);
      skipped++;
    }
  }

  console.log(`\n✅ Done — ${patched} patched, ${skipped} already clean`);
}

await main();
