#!/usr/bin/env bun
// Fix ep1 "The Forty-Million-Dollar Glitter Bomb" — story exists but has no cues.
// Detects scene breaks and generates images for the existing story.
// Run: bun run scripts/inception-ep1-fix.ts

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
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const STORY_ID = "e5caadc0-0f6b-4aca-b9e4-a2dc70a4f1f9"; // ep1 existing story
const WORLD_SLUG = "queen-scarlet";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function genId(len = 8) {
  let s = ""; for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]; return s;
}

async function sb(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`sb_${res.status}: ${t.slice(0, 400)}`); }
  return res.headers.get("content-type")?.includes("json") ? res.json() : null;
}

async function sbUpload(sp: string, data: Uint8Array, mime: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/qss-scenes/${sp}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": mime, "x-upsert": "true", "Cache-Control": "public, max-age=31536000, immutable" },
    body: data,
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`storage_${res.status}: ${t.slice(0, 300)}`); }
  return `${SUPABASE_URL}/storage/v1/object/public/qss-scenes/${sp}`;
}

const BREAK_SYSTEM = `You are a picture-book art director. Find where the illustration should change in a kid's story block. Return character offsets.

BREAK AT: explicit scene cuts, new named characters, setting changes, tonal swings, surprising new images.
DON'T BREAK AT: every paragraph, small moves the same picture could cover.

OUTPUT — strict JSON: { "breaks": [ { "offset": number, "label": "short phrase", "why": "one sentence" }, ... ] }
Cap at 16 breaks. If short (<300 chars) or no breaks, return { "breaks": [] }.`;

async function detectBreaks(text: string): Promise<Array<{ offset: number; label: string; why: string }>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", max_tokens: 2000, system: BREAK_SYSTEM,
      messages: [{ role: "user", content: `Find image-break offsets. JSON only.\n\nTEXT (length=${text.length}):\n${text}` }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`claude_${res.status}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  const raw = (data.content?.[0]?.text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(raw) as { breaks: Array<{ offset: number; label: string; why: string }> };
  return (parsed.breaks || []).filter(b => b.offset > 0 && b.offset < text.length).slice(0, 16);
}

const ART_STYLE = `Hand-drawn children's storybook illustration, thick black ink outlines, flat cel-shaded colors on warm cream paper (#F4ECD8). Lauren Child and Oliver Jeffers style — scrappy, warm, classroom-comedy. Palette: tomato red, butter yellow, teal, ochre, sky blue, mossy green. Skin tones: deep brown, warm brown, golden, olive. Full bodies visible, wide establishing shot, figures in lower 55%, breathing room above heads. ONE single image, ONE moment, NO comic panels, NO speech bubbles, NO visible text.`;

async function generateImage(label: string, excerpt: string): Promise<{ base64: string; mime: string } | null> {
  const prompt = `${ART_STYLE}\n\nSCENE: ${label}\n\nWHAT HAPPENS:\n${excerpt.slice(0, 800)}`;
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) { console.log(`  ⚠ gemini ${res.status}`); return null; }
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ inlineData?: { data: string; mimeType: string } }> } }> };
  for (const c of (data.candidates || [])) for (const p of (c.content?.parts || [])) if (p.inlineData?.data) return { base64: p.inlineData.data, mime: p.inlineData.mimeType || "image/png" };
  return null;
}

function b64toUint8(b64: string): Uint8Array { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const EP1_TEXT = `Mark Rober was a man who loved science. He loved squirrel obstacle courses, he loved dropping eggs from space, and he absolutely loved shooting glitter at package thieves.

He did not love the woman currently sitting in his filming studio.

Queen Scarlet sat atop a stool, sipping from a mug that said WORLD'S OKAYEST SURVIVOR, flanked by two men in full hazmat suits. On the table between her and Mark sat a standard-issue CrunchLabs cardboard box.

"I love your work, Mark," Scarlet beamed, her eyes twitching with excessive caffeine. "The engineering! The passion! The fact that you understand the fundamental truth that all problems can be solved with sufficient velocity!"

"Thank you," Mark said cautiously. "But I usually make, you know, fun physics toys. I don't really see how my brand aligns with a school for... nuclear apocalypse preparedness."

Scarlet snapped her fingers. One of the hazmat men placed a briefcase on the table and popped the latches. It was completely stuffed with cash.

"Forty million dollars," Scarlet whispered.

Mark choked on his own spit.

"Just for one sponsorship video," Scarlet continued, leaning in so close Mark could smell the shelf-stable cheese on her breath. "A special, limited-edition Queen Scarlet CrunchLabs box. We'll teach the kids real, practical STEM skills. Things they actually need."

Mark looked at the money. He thought about the engineering scholarships he could fund. He thought about how many slow-motion cameras he could buy. He slowly reached out and opened the prototype box on the table. Inside was a brightly colored instruction booklet, some plastic gears, a Nerf dart, and a heavy, glowing cylinder labeled: WARNING: ACTUAL WEAPONS-GRADE PAYLOAD (DO NOT EAT).

"This is a miniature nuclear weapon," Mark said, his voice terribly high.

"It's a learning opportunity," Scarlet corrected. "And the Nerf blaster is heavily modified to fire a miniaturized, heat-seeking cruise missile! It teaches aerodynamics!"

Mark stared at the forty million dollars. He stared at the glowing cylinder.

"Well," Mark sighed, putting on his signature backward baseball cap. "I guess I need to get the safety squints."

Two weeks later, the video dropped. Mark stood in front of his pegboard wall, smiling a smile that did not reach his terrified eyes.

"Hey guys!" he chirped to the camera. "Today's video is sponsored by Queen Scarlet! Have you ever looked at a standard Nerf battle and thought, 'Wow, this really lacks mutually assured destruction?' Well, thanks to this month's special CrunchLabs box..."`;

async function main() {
  console.log("🔧 EP1 Fix — The Forty-Million-Dollar Glitter Bomb");
  console.log(`   Story ID: ${STORY_ID}\n`);

  const blockId = genId(8);

  // Reset blocks with fresh blockId
  await sb("PATCH", `qss_stories?id=eq.${STORY_ID}`, {
    blocks: [{ id: blockId, text: EP1_TEXT, __cues: [] }],
    rules: { inception: true, arc: "The CrunchLabs Apocalypse" },
    updated_at: new Date().toISOString(),
  });
  console.log("✓ Blocks reset\n");

  console.log("Detecting scene breaks...");
  const breaks = await detectBreaks(EP1_TEXT);
  console.log(`✓ Found ${breaks.length} breaks`);

  const cues: Array<{ id: string; offset: number; label: string; auto: boolean; image?: { url: string; mimeType: string } }> = [
    { id: genId(8), offset: 0, label: "opening — Mark in studio", auto: true },
    ...breaks.map(b => ({ id: genId(8), offset: b.offset, label: b.label, auto: true })),
  ];

  console.log(`\nGenerating ${cues.length} images...`);
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const nextOffset = cues[i + 1]?.offset ?? EP1_TEXT.length;
    const excerpt = EP1_TEXT.slice(cue.offset, nextOffset);
    console.log(`  🎨 [${i + 1}/${cues.length}] "${cue.label.slice(0, 50)}"`);
    let img = null;
    for (let attempt = 0; attempt < 3 && !img; attempt++) {
      if (attempt > 0) { console.log(`  ↩ retry ${attempt}...`); await sleep(3000); }
      try { img = await generateImage(cue.label, excerpt); } catch (e) { console.log(`  ⚠ Error: ${e}`); }
    }
    if (img) {
      try {
        const ext = img.mime.includes("jpeg") ? "jpg" : "png";
        const varId = `primary-${Date.now().toString(36)}`;
        const sp = `${WORLD_SLUG}/${STORY_ID}/storybook/${blockId}/${cue.id}-${varId}.${ext}`;
        const url = await sbUpload(sp, b64toUint8(img.base64), img.mime);
        cue.image = { url, mimeType: img.mime };
        console.log(`  ✓ Uploaded: ...${url.split("/").slice(-2).join("/")}`);
      } catch (e) { console.log(`  ⚠ Upload failed: ${e}`); }
    } else {
      console.log(`  ⚠ No image after 3 attempts — skipping`);
    }
    if (i < cues.length - 1) await sleep(2000);
  }

  await sb("PATCH", `qss_stories?id=eq.${STORY_ID}`, {
    blocks: [{ id: blockId, text: EP1_TEXT, __cues: cues }],
    updated_at: new Date().toISOString(),
  });
  const withImages = cues.filter(c => c.image).length;
  console.log(`\n✅ Done! ${withImages}/${cues.length} cues have images`);
}

await main();
