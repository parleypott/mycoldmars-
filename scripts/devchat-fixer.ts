#!/usr/bin/env bun
// DevChat Fixer — the live pipe from the Interpreter's in-app DevChat to Parley.
//
// Runs on the Redoubt (always-on). Watches devchat_messages for new user
// requests, runs `claude -p` INSIDE the mycoldmars repo to actually make the
// change, build-gates it, ships it (git push → Vercel auto-deploys), and
// replies in the thread with what shipped — so Johnny or Jeremy can micro-fix
// the Interpreter by just chatting, no different than the main Claude Code chat.
//
// Safety net: every change is `bun run build`-gated. A change that breaks the
// build is reverted and reported, never shipped. One request at a time.
//
// Env required: SUPABASE_URL, SUPABASE_SERVICE_KEY, CLAUDE_CODE_OAUTH_TOKEN.
// Run: bun scripts/devchat-fixer.ts   (as a systemd service on the fort)

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SVC = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REPO = process.env.MCM_REPO || join(homedir(), 'mycoldmars');
const POLL_MS = Number(process.env.DEVCHAT_POLL_MS || 12000);
const STATE_DIR = join(homedir(), '.devchat-fixer');
const STATE_FILE = join(STATE_DIR, 'processed.json');

if (!SUPA_URL || !SVC) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) console.warn('[warn] CLAUDE_CODE_OAUTH_TOKEN not set — claude -p will fail');
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

// ── tiny Supabase REST helpers (service role — no supabase-js needed) ──
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`REST ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}
const postMessage = (thread_id: string, body: string, sender = 'agent') =>
  rest('devchat_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ thread_id, sender, body }) });
const setThread = (id: string, patch: Record<string, unknown>) =>
  rest(`devchat_threads?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });

// ── processed-cursor so we never handle a message twice ──
function loadProcessed(): Set<string> {
  try { return new Set(JSON.parse(readFileSync(STATE_FILE, 'utf8'))); } catch { return new Set(); }
}
function saveProcessed(s: Set<string>) {
  try { writeFileSync(STATE_FILE, JSON.stringify([...s].slice(-2000))); } catch {}
}

function sh(cmd: string, args: string[], cwd = REPO, timeoutMs = 600000) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: process.env, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}

// ── the agent prompt — this is what makes DevChat "no different than the main chat" ──
function buildPrompt(thread: any, messages: any[]) {
  const convo = messages.map((m) => `${m.sender.toUpperCase()}: ${m.body}`).join('\n\n');
  return `You are Parley, working as the live in-product dev assistant for the Newpress Interpreter — a transcript editing/translation tool. You have FULL ability to edit and ship real code, exactly like the main Claude Code chat.

The user is testing the live tool and wants a change. The Interpreter's frontend lives under translation/ in this repo (Vite + Preact, vanilla JS, no TypeScript). Edge functions are under api/.

THE CONVERSATION (most recent last):
${convo}

CONTEXT: page they were on = ${thread?.page_url || 'unknown'}.

YOUR JOB:
- If this is a concrete code change you can make to the Interpreter, MAKE IT NOW — edit the real files under translation/ (or api/). Keep the change MINIMAL and focused on exactly what they asked. Match the surrounding code style. Do not refactor unrelated things.
- After editing, do NOT run the build or git yourself — the harness build-gates, commits, and ships automatically. Just make the edit.
- If the request is ambiguous or you need a decision, DON'T edit — instead ask ONE sharp clarifying question.
- If it's a question or conversation (not a change), just answer concisely.

Your FINAL message (stdout) becomes the reply the user sees in DevChat. So end with a short, plain, lowercase-friendly summary of either: what you changed (1-3 sentences), or your clarifying question, or your answer. No preamble, no "great question", match Johnny's fast-and-loose editorial voice.`;
}

async function handle(thread: any, messages: any[]) {
  const tid = thread.id;
  await postMessage(tid, '🔧 on it — reading your request and getting into the code…').catch(() => {});
  await setThread(tid, { status: 'in_progress' }).catch(() => {});

  // Always work from a clean, current tree.
  sh('git', ['pull', '--rebase', 'origin', 'main']);
  sh('git', ['reset', '--hard']); // drop any stray local edits before we start

  // Run Parley headless in the repo. acceptEdits so it can write files; it is
  // told NOT to build/commit (we do that with the gate below).
  const prompt = buildPrompt(thread, messages);
  const res = sh('claude', ['-p', prompt, '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Edit,Write,Read,Grep,Glob,Bash'], REPO, 600000);
  const reply = (res.stdout.trim() || 'done.').slice(-1500);

  // Did Parley actually change files?
  const dirty = sh('git', ['status', '--porcelain']).out.trim();
  if (!dirty) {
    // No edit → it was a question/answer/clarification. Just relay the reply.
    await postMessage(tid, reply);
    await setThread(tid, { status: 'open' }).catch(() => {});
    return;
  }

  // Build-gate: never ship a broken tool.
  const build = sh('bun', ['run', 'build'], REPO, 300000);
  if (build.code !== 0) {
    sh('git', ['reset', '--hard']); // discard the broken change
    const tail = build.out.split('\n').filter(Boolean).slice(-12).join('\n');
    await postMessage(tid, `⚠️ I made the change but the build broke, so I did NOT ship it (your tool is untouched). Here's the error:\n\n\`\`\`\n${tail}\n\`\`\`\n\n${reply}`);
    await setThread(tid, { status: 'open' }).catch(() => {});
    return;
  }

  // Ship it.
  sh('git', ['add', '-A']);
  const subject = reply.split('\n')[0].slice(0, 72);
  const commit = sh('git', ['commit', '-m', `devchat: ${subject}\n\nShipped via DevChat live pipe. Thread ${tid}.`]);
  const push = sh('git', ['push', 'origin', 'main']);
  const sha = sh('git', ['rev-parse', '--short', 'HEAD']).out.trim();

  if (push.code !== 0) {
    await postMessage(tid, `I made and built the change (commit ${sha}) but the push failed:\n\n\`\`\`\n${push.out.split('\n').slice(-6).join('\n')}\n\`\`\`\nIt's committed locally on the fort; I'll retry on the next run.`);
    return;
  }
  await postMessage(tid, `✅ shipped — ${reply}\n\ncommit \`${sha}\` · deploying to production now, give it ~60 seconds then refresh.`);
  await setThread(tid, { status: 'shipped', commit_sha: sha }).catch(() => {});
  console.log(`[devchat-fixer] shipped ${sha} for thread ${tid}`);
}

// ── poll loop ──
async function tick(processed: Set<string>) {
  // Recent user messages (last 2h), newest first. NOTE: encode timestamp values —
  // a raw "+00:00" offset becomes a space in the query string and PostgREST then
  // rejects it as an invalid timestamp (22007).
  const sinceIso = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const msgs: any[] = await rest(`devchat_messages?select=id,thread_id,sender,body,created_at&sender=eq.user&created_at=gt.${encodeURIComponent(sinceIso)}&order=created_at.asc`);
  for (const m of msgs) {
    if (processed.has(m.id)) continue;
    // Skip if this thread already has a later non-user message (already answered).
    const later: any[] = await rest(`devchat_messages?select=id,sender&thread_id=eq.${m.thread_id}&created_at=gt.${encodeURIComponent(m.created_at)}&sender=neq.user&limit=1`);
    if (later.length) { processed.add(m.id); continue; }
    // Load the whole thread for context.
    const [thread] = await rest(`devchat_threads?select=id,page_url,page_state,title,status&id=eq.${m.thread_id}`);
    const messages: any[] = await rest(`devchat_messages?select=sender,body,created_at&thread_id=eq.${m.thread_id}&order=created_at.asc`);
    processed.add(m.id); saveProcessed(processed);
    try { await handle(thread, messages); }
    catch (e: any) {
      console.error('[devchat-fixer] handle error:', e?.message || e);
      await postMessage(m.thread_id, `I hit an error trying to make that change: ${e?.message || e}. Flagging it for Johnny.`).catch(() => {});
    }
    return; // one request per tick — keep git operations serialized
  }
}

console.log(`[devchat-fixer] watching DevChat → Interpreter at ${REPO}, every ${POLL_MS}ms`);
const processed = loadProcessed();
// Don't retro-answer old messages from before the worker started.
{
  const boot: any[] = await rest(`devchat_messages?select=id&sender=eq.user&created_at=gt.${new Date(Date.now() - 2 * 3600 * 1000).toISOString()}`).catch(() => []);
  for (const m of boot) processed.add(m.id);
  saveProcessed(processed);
  console.log(`[devchat-fixer] seeded ${processed.size} existing messages as already-seen`);
}
while (true) {
  try { await tick(processed); } catch (e: any) { console.error('[devchat-fixer] tick error:', e?.message || e); }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
