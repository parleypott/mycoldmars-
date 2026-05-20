#!/usr/bin/env bun
// Run every image through Claude vision, append structured analysis to ./comments.json
// Resumable — skips IDs already analyzed. Re-run safely.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const ROOT = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith("/") ? process.env.DATA_DIR : join(process.cwd(), process.env.DATA_DIR))
  : dirname(new URL(import.meta.url).pathname);
const FILES_PATH = join(ROOT, "files.json");
const COMMENTS_PATH = join(ROOT, "comments.json");
const MODEL = "claude-sonnet-4-6";
const CONCURRENCY = 4;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in env");
  process.exit(1);
}

const client = new Anthropic();

type FileRecord = {
  id: string;
  name: string;
  ext: string;
  mimetype: string;
  size: number | null;
  local_path: string;
  slack_user: string | null;
  slack_ts: string;
  slack_permalink: string | null;
  posted_at: string;
};

type Sentiment =
  | "praise" | "insightful" | "funny" | "critical"
  | "personal_story" | "question" | "correction" | "other";

type Analysis = {
  comment_text: string | null;
  commenter: string | null;
  sentiment: Sentiment;
  themes: string[];
  video_hint: string | null;
  is_question: boolean;
  is_criticism: boolean;
  skip?: boolean;
  reason?: string;
};

type CommentRecord = FileRecord & {
  analysis: Analysis;
  analyzed_at: string;
};

const PROMPT = `You're cataloging a YouTube comment screenshot for a creator's pitch deck.

Extract structured data and return STRICT JSON only (no prose, no markdown fences).

Fields:
- comment_text: the actual body of the YouTube comment, verbatim. Strip the username/timestamp/like-count UI chrome. null if you can't read it.
- commenter: YouTube username if visible, else null.
- sentiment: one of "praise" | "insightful" | "funny" | "critical" | "personal_story" | "question" | "correction" | "other".
- themes: 1-4 short lowercase tags describing what the comment is about (e.g. "cinematography", "taiwan", "pacing", "host", "music", "editing").
- video_hint: if the comment references a specific video or topic that suggests which video, note it briefly; else null.
- is_question: boolean.
- is_criticism: boolean — true even if constructive.

If the image isn't a YouTube comment screenshot, return: {"skip": true, "reason": "what it is instead"}.

Return only the JSON object.`;

function mimeFor(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return `image/${ext}`;
}

async function loadFiles(): Promise<FileRecord[]> {
  const txt = await readFile(FILES_PATH, "utf8");
  return JSON.parse(txt);
}

async function loadComments(): Promise<Record<string, CommentRecord>> {
  try {
    const txt = await readFile(COMMENTS_PATH, "utf8");
    const arr = JSON.parse(txt) as CommentRecord[];
    return Object.fromEntries(arr.map(r => [r.id, r]));
  } catch { return {}; }
}

async function saveComments(records: Record<string, CommentRecord>): Promise<void> {
  const arr = Object.values(records).sort((a, b) => b.slack_ts.localeCompare(a.slack_ts));
  await writeFile(COMMENTS_PATH, JSON.stringify(arr, null, 2));
}

function extractJson(text: string): any {
  // tolerate code fences just in case
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return JSON.parse(cleaned);
}

async function analyzeOne(file: FileRecord): Promise<Analysis> {
  const imgPath = join(ROOT, file.local_path);
  const buf = await readFile(imgPath);
  const b64 = buf.toString("base64");
  const media_type = mimeFor(file.ext);

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0.2,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type, data: b64 } as any },
        { type: "text", text: PROMPT },
      ],
    }],
  });

  const block = res.content.find(b => b.type === "text") as any;
  if (!block?.text) throw new Error("no text in claude response");
  const parsed = extractJson(block.text);

  if (parsed.skip) {
    return {
      comment_text: null, commenter: null, sentiment: "other",
      themes: [], video_hint: null, is_question: false, is_criticism: false,
      skip: true, reason: parsed.reason || "skipped",
    };
  }

  return {
    comment_text: parsed.comment_text ?? null,
    commenter: parsed.commenter ?? null,
    sentiment: parsed.sentiment ?? "other",
    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
    video_hint: parsed.video_hint ?? null,
    is_question: !!parsed.is_question,
    is_criticism: !!parsed.is_criticism,
  };
}

async function runPool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const i = cursor++;
      const item = items[i];
      if (i >= items.length || item === undefined) return;
      await worker(item, i);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const files = await loadFiles();
  const comments = await loadComments();
  const todo = files.filter(f => !comments[f.id]);
  console.log(`${files.length} files total, ${todo.length} to analyze, ${files.length - todo.length} already done`);

  if (!todo.length) {
    console.log("nothing to do — comments.json is current");
    return;
  }

  let done = 0;
  let failed = 0;
  await runPool(todo, CONCURRENCY, async (file) => {
    try {
      const analysis = await analyzeOne(file);
      comments[file.id] = { ...file, analysis, analyzed_at: new Date().toISOString() };
      done++;
      if (done % 5 === 0 || done + failed === todo.length) {
        await saveComments(comments);
      }
      process.stdout.write(`\r✓ ${done}/${todo.length}  (✗ ${failed})`);
    } catch (err) {
      failed++;
      console.error(`\n✗ ${file.id}: ${(err as Error).message}`);
    }
  });

  await saveComments(comments);
  process.stdout.write("\n");
  console.log(`done — ${done} analyzed, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
