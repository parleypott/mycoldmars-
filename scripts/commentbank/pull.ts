#!/usr/bin/env bun
// Pull every image from a Slack channel into ./images/, write metadata to ./files.json
// Idempotent — skips files already on disk. Re-run to pick up new posts.

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";

const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL = process.env.SLACK_CHANNEL_ID;
const ROOT = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith("/") ? process.env.DATA_DIR : join(process.cwd(), process.env.DATA_DIR))
  : dirname(new URL(import.meta.url).pathname);
const IMG_DIR = join(ROOT, "images");
const META_PATH = join(ROOT, "files.json");

if (!TOKEN || !CHANNEL) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID in env");
  process.exit(1);
}

type SlackFile = {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  url_private_download?: string;
  url_private?: string;
  permalink?: string;
  size?: number;
  user?: string;
  created?: number;
};

type SlackMessage = {
  ts: string;
  user?: string;
  text?: string;
  files?: SlackFile[];
  permalink?: string;
};

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

async function slack<T = any>(method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const json = await res.json() as any;
  if (!json.ok) throw new Error(`slack.${method} failed: ${json.error}`);
  return json as T;
}

async function pageHistory(): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    page++;
    const params: Record<string, string> = { channel: CHANNEL!, limit: "200" };
    if (cursor) params.cursor = cursor;
    const data = await slack<any>("conversations.history", params);
    const msgs: SlackMessage[] = data.messages || [];
    out.push(...msgs);
    cursor = data.response_metadata?.next_cursor || undefined;
    process.stdout.write(`\rpage ${page} — ${out.length} messages`);
    if (cursor) await new Promise(r => setTimeout(r, 250));
  } while (cursor);
  process.stdout.write("\n");
  return out;
}

async function fetchReplies(thread_ts: string): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = { channel: CHANNEL!, ts: thread_ts, limit: "200" };
    if (cursor) params.cursor = cursor;
    try {
      const data = await slack<any>("conversations.replies", params);
      const msgs: SlackMessage[] = data.messages || [];
      // first message in replies is the parent; skip it (we already have it)
      out.push(...msgs.slice(1));
      cursor = data.response_metadata?.next_cursor || undefined;
      if (cursor) await new Promise(r => setTimeout(r, 250));
    } catch { return out; }
  } while (cursor);
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

function extFromMime(mime: string | undefined, name: string | undefined): string {
  if (mime?.startsWith("image/")) {
    const sub = mime.split("/")[1];
    if (!sub) return "bin";
    if (sub === "jpeg") return "jpg";
    return sub;
  }
  if (name && name.includes(".")) {
    const ext = name.split(".").pop();
    if (ext) return ext.toLowerCase();
  }
  return "bin";
}

function isImage(f: SlackFile): boolean {
  return !!(f.mimetype?.startsWith("image/"));
}

async function downloadFile(f: SlackFile, dest: string): Promise<void> {
  const url = f.url_private_download || f.url_private;
  if (!url) throw new Error(`no url for file ${f.id}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`download ${f.id} → ${res.status} ${res.statusText}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) throw new Error(`got HTML, not image — token scopes wrong?`);
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function getPermalink(channel: string, ts: string): Promise<string | null> {
  try {
    const r = await slack<any>("chat.getPermalink", { channel, message_ts: ts });
    return r.permalink || null;
  } catch { return null; }
}

async function loadExisting(): Promise<Record<string, FileRecord>> {
  try {
    const txt = await readFile(META_PATH, "utf8");
    const arr = JSON.parse(txt) as FileRecord[];
    return Object.fromEntries(arr.map(r => [r.id, r]));
  } catch { return {}; }
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });
  const existing = await loadExisting();
  console.log(`existing records: ${Object.keys(existing).length}`);

  console.log("paginating channel history…");
  const topLevel = await pageHistory();
  console.log(`fetched ${topLevel.length} top-level messages`);

  // walk threads — any message with thread_ts === ts (and reply_count > 0) is a parent
  const threadParents = topLevel.filter((m: any) => m.thread_ts === m.ts && (m.reply_count || 0) > 0);
  console.log(`fetching replies from ${threadParents.length} threads…`);
  const messages: SlackMessage[] = [...topLevel];
  for (let i = 0; i < threadParents.length; i++) {
    const parent = threadParents[i]!;
    const replies = await fetchReplies(parent.ts);
    messages.push(...replies);
    process.stdout.write(`\rthread ${i + 1}/${threadParents.length} — +${replies.length} replies (total ${messages.length} msgs)`);
  }
  if (threadParents.length) process.stdout.write("\n");
  console.log(`total messages incl. threads: ${messages.length}`);

  const records: Record<string, FileRecord> = { ...existing };
  let downloaded = 0;
  let skipped = 0;

  for (const msg of messages) {
    if (!msg.files?.length) continue;
    for (const f of msg.files) {
      if (!isImage(f)) continue;
      const existingRec = records[f.id];
      if (existingRec && await fileExists(join(ROOT, existingRec.local_path))) {
        skipped++;
        continue;
      }
      const ext = extFromMime(f.mimetype, f.name);
      const dest = join(IMG_DIR, `${f.id}.${ext}`);
      try {
        if (!await fileExists(dest)) {
          await downloadFile(f, dest);
          downloaded++;
          process.stdout.write(`\r↓ ${downloaded} downloaded, ${skipped} skipped`);
        } else {
          skipped++;
        }
        const permalink = await getPermalink(CHANNEL!, msg.ts);
        records[f.id] = {
          id: f.id,
          name: f.title || f.name || f.id,
          ext,
          mimetype: f.mimetype || "image/unknown",
          size: f.size ?? null,
          local_path: `images/${f.id}.${ext}`,
          slack_user: msg.user || null,
          slack_ts: msg.ts,
          slack_permalink: permalink,
          posted_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
        };
        await writeFile(META_PATH, JSON.stringify(Object.values(records), null, 2));
      } catch (err) {
        console.error(`\n✗ ${f.id}: ${(err as Error).message}`);
      }
    }
  }

  process.stdout.write("\n");
  console.log(`done — ${downloaded} new, ${skipped} already had, ${Object.keys(records).length} total`);
}

main().catch(e => { console.error(e); process.exit(1); });
